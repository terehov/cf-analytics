# FoodNotify — vollständiges API-Inventar

Erhoben am 27.07.2026 gegen die angemeldete Sitzung der Marke **Enchilada**
(Konto `Admin.foodnotify@enchilada.de`), ausschließlich lesend (GET). Keine
Formulare abgesendet, keine Inventur abgeschlossen, keine Bestellung ausgelöst.

Erhebungsmethode: Netzwerkmitschnitt der Oberfläche plus Auswertung aller 47
JavaScript-Bundles der beiden SPAs. Insgesamt **126 API-Pfade** gefunden.

---

## Nachtrag 01.08.2026 — drei Aussagen dieses Dokuments sind überholt

Dieses Inventar bleibt als Befundlage vom 27.07. stehen. Wo es unten anders
klingt, gilt der Plan (`docs/plan-foodnotify.md`) und der Prüfbericht
(`docs/foodnotify-0-1-nummernraum.md`).

**1. „POS-Verknüpfung — die Brücke zu LINA, noch verschlossen" (§5) ist
gelöst.** Der Parameter ist die **`connectionId`** aus `/api/pos/locations`,
nicht die dort vermutete Account-ID. Damit liefern
`/api/pos/mapping/{connectionId}/articles` und `/link-targets` HTTP 200 mit
vollständigen Daten. Die Brücke zu LINA ist `plu = core.artikel.artikelnummer`
(99,7 % Namensgleichheit gegen 0,3 % Zufallserwartung). Die in §5 als
Sackgasse notierten 404 kamen daher, dass alle durchprobierten IDs aus den
falschen Namensräumen stammten.

**2. „Den Fehler melden, bevor irgendetwas gebaut wird" (§9b) gilt nicht
mehr.** Entscheidung Eugene, 01.08.2026: kein Support-Kontakt. Der
Verkaufsfehler aus §8a blockiert FoodNotifys eigene Soll-Rechnung, nicht
unsere — wir nehmen die Verkaufsmengen aus LINA und die Zutatenkosten aus
`zutat.cost`. Belegt an Aposto Gera: 19,8 % Wareneinsatzquote, plausibel.
Verkäufe und Kostenanalyse werden deshalb **gar nicht importiert**, siehe
`docs/entscheidungen.md`.

**3. Die Auth-Beschreibung in §1 stimmt nicht.** Dort steht „JWT im
`localStorage`". Gemessen: im `localStorage` liegt **kein Token**, nur
Oberflächeneinstellungen; `/api/profile` antwortet trotzdem mit 200. Die
Sitzung hängt an einem **HttpOnly-Cookie**. Für den Importer ist das die
bessere Nachricht — dasselbe Muster wie bei LINA.

Ebenfalls geklärt, offener Punkt 4 aus §10: **Rezepturen werden je Marke
getrennt gepflegt.** Aposto hat 672 Rezepte, Enchilada 1.846.

---

## Kurzfassung

**FoodNotify ist technisch das Gegenteil von LINA.** Sauberes REST, durchgehend
JSON, paginiert, sortierbar. Alles, was wir bei LINA mühsam rekonstruiert haben,
liegt hier offen.

Drei Dinge, die den Ausschlag geben:

1. **Rezepturen mit Mengen und Kosten je Zutat** — die größte Lücke des Projekts, geschlossen.
2. **Eine fertige Ist-gegen-Soll-Wareneinsatzrechnung** samt Food/Beverage-Split, Warenbewegung je Zutag und Geschäftstag, und Renner-Penner-Analyse mit Deckungsbeitrag. Das ist inhaltlich mehr, als wir in Postgres nachbauen wollten.
3. **Der Bar/Küche-Split**, den wir aus LINA nicht bilden konnten.

**Aber:** Die Cost-Analysis-Daten sind für diese Marke **fast leer**. Die
Schnittstelle ist da, die Zahlen dahinter sind es nicht. Dazu unten mehr — das
ist der wichtigste Vorbehalt des ganzen Dokuments.

---

## 1. Technik

| | |
|---|---|
| Backend | Symfony; Fehlerseiten liefern vollständige Stacktraces |
| Frontends | drei: Angular unter `/panel/…`, eine neuere SPA unter `/brew/…`, klassisch gerendert unter `/recipes` |
| Auth | JWT im `localStorage`; die Session-Cookies authentifizieren `/api/`-Aufrufe ebenfalls — ein `fetch` aus der Seite braucht keinen Authorization-Header |
| Login | `POST /api/user/auth/signin_check` |
| **2FA** | vollständig vorhanden: E-Mail, TOTP, Trusted Devices, Reset |
| Analytics | **Tableau-Einbettung**, kein eigenes API (siehe §7) |

### Drei Antworthüllen

```
{code, errors, isError, payload}                                    /api/erp/*
{data, pagination:{currentPage,perPage,totalItems,totalPages}}      /api/recipes
{order_by, order_direction, current_page, current_page_size,
 page_count, total_count, data, currency}                           /api/{erpId}/*
```

Die Cost-Analysis-Endpunkte liefern **nackte Arrays ohne Hülle**. Der
Transformationslayer muss vier Fälle unterscheiden.

### Drei Schlüsselebenen — nicht verwechseln

```
restaurant.id     10945   der Betrieb
costCenter.id     11544   die Kostenstelle (Bar oder Küche)
erpId             11033   die Warenwirtschaft dieser Kostenstelle
```

`/api/erp/all` und `/api/erp/available` liefern alle drei im Zusammenhang —
**58 Kostenstellen** für Enchilada, je Betrieb eine Bar und eine Küche. Alle drei
Schlüssel gehören ins Datenmodell.

---

## 2. Der wichtigste Fund: die Kostenanalyse

```
GET /api/analytics/reports/cost-analysis/ingredients
GET /api/analytics/reports/cost-analysis/ingredients/cards
GET /api/analytics/reports/cost-analysis/ingredients/by-month
GET /api/analytics/reports/cost-analysis/ingredients/by-product
GET /api/analytics/reports/cost-analysis/ingredients/by-restaurant
GET /api/analytics/reports/cost-analysis/ingredients/food-waste
GET /api/analytics/reports/cost-analysis/ingredients/single/:id/:id
GET /api/analytics/reports/cost-analysis/runner-bummer/ingredients
GET /api/analytics/reports/cost-analysis/runner-bummer/unmapped
```

**`ingredients`** — Warenbewegung je Zutat und Geschäftstag:

```
restaurantId, restaurantName, businessDate, concreteProductId, ingredientId,
concreteProductName, openingStockQty, closingStockQty, openingStockValue,
closingStockValue, importQty, importValue, transferQty, transferValue, …
```

Anfangsbestand, Endbestand, Zugänge, Transfers — mengenmäßig **und** wertmäßig.
Damit ist Schwund exakt berechenbar statt geschätzt. Das ist genau die Rechnung,
die `mart.pruefung_wareneinsatz` nur näherungsweise abbilden konnte.

**`cards`** — die Kennzahlen auf einen Blick:

```
posTurnoverMapped, posTurnoverNet, posTurnoverMappedFood, posTurnoverMappedBeverage,
actualFnbCost, theoreticalFnbCost, actualFnbCostPercentage, theoreticalFnbCostPercentage,
potentialCostSavings, potentialCostSavingsPercentage
```

**Ist- gegen Soll-Wareneinsatz, getrennt nach Food und Beverage, mit
Einsparpotenzial.** Fertig gerechnet, mit dem Split, den wir nicht bilden konnten.

**`by-product`** liefert je Produkt `actualFnbCost, theoreticalFnbCost, diff,
diffPercentage, isFood, isBeverage` — die Abweichungsliste, nach der man sucht.

**`food-waste`** trennt sauber: `breakageValue` (Bruch), `spoilageValue`
(Verderb), `rawWasteValue`, `totalWasteValue` je Betrieb und Geschäftstag.

**`runner-bummer`** — Renner-Penner mit Deckungsbeitrag je POS-Artikel:

```json
{"posRecipeName":"0,25l Red Bull","quantity":175,"posCost":216.05,
 "turnover":658.15,"netTurnover":658.15,"profit":442.10}
```

**`runner-bummer/unmapped`** ist die Kehrseite: Artikel **ohne**
Rezeptzuordnung. Dort steht `posCost: 0` und `turnover: 0`, aber `netTurnover`
hat Werte — diese Umsätze fehlen in jeder Wareneinsatzrechnung.

### Der große Vorbehalt

Die Daten hinter dieser Schnittstelle sind für Enchilada **weitgehend leer**:

| Kennzahl | Wert |
|---|---|
| `posTurnoverNet` | 3.049.801 € |
| `posTurnoverMapped` | 1.346.802 € — **nur 44 %** |
| `actualFnbCost` | −30,50 € |
| `theoreticalFnbCost` | 0 |
| Betriebe mit Daten in `by-restaurant` | **1** (Enchilada Rosenheim) |

Nur 44 % des Kassenumsatzes sind überhaupt einem Rezept zugeordnet, und die
Kostenwerte sind praktisch null. Die Schnittstelle funktioniert — die
Datenpflege dahinter nicht. **Das ist eine fachliche Aufgabe bei euch, kein
technisches Problem**, und es ist die Voraussetzung dafür, dass diese
Auswertungen überhaupt etwas wert sind.

`runner-bummer` liefert dagegen echte Daten (je 50 Zeilen).

**Zeitparameter werden ignoriert.** `from/to`, `dateFrom/dateTo` ändern das
Ergebnis nicht. Entweder erwartet die Schnittstelle andere Namen, oder der
Zeitraum kommt aus einer gespeicherten Auswahl. Noch zu klären.

---

## 3. Rezepturen

```
GET /api/recipes?page=1                    1.846 Rezepte, 25/Seite fix, 74 Seiten
GET /api/recipes/{id}                      Kopfdaten
GET /api/recipes/{id}/ingredients          ← das Entscheidende
GET /api/recipes/{id}/meta                 weight, allergens, additives, nutritions
GET /api/recipes/{id}/steps                Zubereitungsschritte
GET /api/recipes/tags
GET /api/recipes/distinct-categories
GET /api/recipes/batch                     Methode ungeprüft (vermutlich POST)
GET /api/recipes/dashboard-mix/{id}
GET /api/recipes/dashboard-mix/{id}/items
GET /api/recipes/dashboard-mix/{id}/monthly-costs
GET /api/recipes/dashboard-mix/restaurants
```

Zutaten je Rezept:

```
id, kind, name, quantity, unit, cost, artikelId, supplier, subRecipeId, group
```

`perPage` wird **ignoriert** — die Seitengröße ist fest bei 25.

**`subRecipeId`: Rezepte enthalten Rezepte.** Die Auflösung muss rekursiv sein,
sonst fehlen die Kosten der Zwischenprodukte. Zyklen abfangen.

---

## 4. Warenwirtschaft

```
GET /api/erp/available                          Kostenstellen mit erpId
GET /api/erp/all                                dasselbe, 58 Einträge
GET /api/{erpId}/products?page_size=N&stocktakingVisibility=visible
GET /api/erp/product-groups
GET /api/erp/product-groups/{id}/products
GET /api/erp/commodity-groups                   20 Warengruppen
GET /api/erp/commodity-groups/{id}
GET /api/erp/concrete-products
GET /api/erp/unit/product-units/{id}
GET /api/erp/last-used/{id}
GET /api/{erpId}/dashboard
GET /api/completion/{costCenterId}/overall
GET /api/completion/{costCenterId}/empty-product-groups
```

### Inventuren — vollständig, bis auf die Positionsebene geprüft

```
GET /api/erp/stocktakings?erpIds[]=…&erpIds[]=…&page=1&order_by=timeCreated
GET /api/erp/stocktakings/{uuid}
GET /api/erp/stocktakings/{uuid}/items          ← die Zählung
GET /api/erp/stocktakings/validation/{erpId}
GET /api/erp/stocktakings/validation/{erpId}/check
```

Kopf: `id (UUIDv7), erpId, name, type, createdAt, timeModified, status,
totalNumberOfItems, storagesToCount, signature, note, commodityGroups`
Status: `signed`, `counting`, `canceled`.

**`erpIds[]` ist ein Array** — alle 58 Kostenstellen in einem Aufruf. 20 Einträge
je Seite, 4 Seiten, also **rund 70 Inventuren insgesamt, alle aus 2026**. Die
Historie ist flach: etwa eine Runde Monatsinventuren, mehr nicht.

**Die Positionen** (`/items`, 178 Zeilen und 276 kB für eine Barinventur):

```json
{"id":"019fba58-…","name":"Granini Orangensaft Mw 6X1,00",
 "shopArticleId":"460614","shopName":"HFS Getränke","baseUnit":"ml",
 "theoreticalStockLevelInBaseUnits":29612.59,
 "countedAmountInBaseUnits":6000,
 "reviewAmountInBaseUnits":6000,
 "pricePerBaseUnit":0.0025533,
 "unitDefinitions":[…], "storageItems":[…], "commodityGroups":[…]}
```

**Sollbestand, gezählte Menge, Nachzählung und Preis je Basiseinheit** — alles in
einer normalisierten Basiseinheit, dazu die Lieferantenartikelnummer. Die
Differenz zwischen `theoreticalStockLevelInBaseUnits` und
`countedAmountInBaseUnits` ist der bewertbare Schwund, und mit `pricePerBaseUnit`
direkt in Euro. Im Beispiel: Soll 29,6 l, gezählt 6,0 l.

### Bestellungen und Einkaufspreise — vollständig, bis auf die Positionsebene geprüft

```
GET /api/{erpId}/shop-order/paginate?page_size=25&page=1&order_by=timeCreated&order_direction=DESC
GET /api/{erpId}/shop-order/{orderId}                    ← Kopf mit Beleg
GET /api/{erpId}/shop-order/{orderId}/change?order_by=name   ← Positionen
GET /api/{erpId}/shop-order/{orderId}/change/paginate/checked?checked=true&page=1&page_size=10
GET /api/{erpId}/product-unit
GET /api/{erpId}/shop-order/get-shops-for-all-orders
GET /api/{erpId}/shop-order/get-status-for-all-orders
GET /api/erp/order/auto-import-settings
GET /api/shop/products/search
GET /api/shop/products/{id}/packagings
GET /api/shop/multi-cost-center-ordering            + /{id}/products /quantities /cost-centers /schedule
GET /api/shop/shopping-list/{id}/export.pdf
```

**Kopf:** `orderNumber, shopOrderStatus, markedShop{shopId,name}, comment,
timeCreated, extDeliveryNoteId, billingSyncStatus, cartId, createdByUser,
updatedByUser` sowie

* `markedShopOrder{total, deliveryDate{timestamp}, products[{price, productId}], orderId}`
* `shopOrderInvoices[{invoiceNumber, invoiceDate, …}]` — **die Rechnungen hängen dran**

**Positionen** (`/change`):

```
id, sumPrice, amount, newPrice, checked, status, orderedAsPiece,
weightWare, weightUnknown, isSubstituted, totalUnitQuantity,
adjustedQuantity, resultingPackaging, isNotEqualSumPrice, isPackagingEqual,
shopOrderMappingProduct{ name, packagingQuantity, unitQuantity,
                         unit{id,name},
                         concreteProduct{id, name, unit, unitQuantity} }
```

**Das ist die Einkaufsseite in voller Tiefe:** Preis je Position, Gebindegröße,
Einheit, normalisierte Gesamtmenge, Lieferant — und über `concreteProduct.id`
die Verknüpfung zum Warenstamm. `newPrice` und `isNotEqualSumPrice` zeigen sogar
Preisabweichungen gegenüber der Bestellung an.

Damit sind es **echte Belegpreise**, nicht Katalogpreise wie in LINAs WAWI. Und
weil jede Bestellung ein Datum trägt, entsteht die **Preishistorie von selbst** —
genau das, was in `docs/datensicherung.md` als „rückwirkend nicht nachholbar"
notiert ist. Hier ist sie nachholbar, soweit die Bestellhistorie reicht.

### Aktuelle Preise und Bestände am Warenstamm

```
GET /api/{erpId}/products?page_size=N&stocktakingVisibility=visible
```

Je Produkt unter anderem: `pricePerUnit, unitPrice, stock, packagingQuantity,
packagingUnits, preferredShopUnit, baseUnitQuantity, baseUnitUnit, unit,
unitQuantity, artikelId, shop, storageProducts, groups, categories,
recipeProduct, showInStocktaking, isOrderable, weightWare`

`artikelId` ist hier wieder da — dieselbe Verknüpfung wie in den Rezeptzutaten.

### Lagerbewegungen und Schwund

```
GET /api/erp/stock-transfer                        + /{id} /products /status /notifications/{erpId}
GET /api/erp/stock-transfer-request                + /{id} /products
GET /api/erp/food-waste-alpha
GET /api/erp/food-waste-alpha/reasons
GET /api/erp/food-waste-alpha/totals
```

Umlagerungen zwischen Kostenstellen — relevant, weil Bar und Küche getrennt
geführt werden und Ware zwischen ihnen wandert. Ohne diese Bewegungen stimmt
keine Schwundrechnung.

---

## 5. POS-Verknüpfung — die Brücke zu LINA, noch verschlossen

```
GET /api/pos/mapping/{accountId}/articles
GET /api/pos/mapping/{accountId}/article-sales
GET /api/pos/mapping/{accountId}/articles/{id}/recipe
GET /api/pos/mapping/{accountId}/link-targets
GET /api/pos/mapping/{accountId}/suggest
GET /api/pos/mapping/{accountId}/jobs
GET /api/pos/mapping/{accountId}/jobs/active
GET /api/pos/sync/reload/{id}
```

**Das ist die Zuordnung LINA-Artikel → FoodNotify-Rezept** — der Join, den wir
brauchen, um `core.artikelverkauf_tag` mit Rezepturen zu verbinden.

Der Parameter ist **nicht** `erpId`, nicht `costCenter.id`, nicht `restaurant.id`
und nicht die Benutzer-ID, sondern eine eigene POS-Account-ID
(`PosBundle\Database\Entity\Account`).

Geprüft und jeweils `404 object not found`: `11033` (erpId), `11544`
(costCenter), `10945`, `10420`, `10407` (restaurant), `10432` (der einzige
Betrieb mit Kostenanalyse-Daten), `18337` (Benutzer).

**Weiter gehe ich hier nicht.** IDs durchzuprobieren wäre Enumeration und keine
Auswertung dessen, was uns die Oberfläche zeigt — das ist eine Grenze, die wir
schon bei LINA nicht überschritten haben. Es gibt im Menü dieses Zugangs auch
keinen POS-Bereich; vermutlich fehlt die Berechtigung oder die Zuordnung wird
ausschließlich von FoodNotify-Seite gepflegt.

**Der saubere Weg:** FoodNotify-Support fragen, wie die POS-Zuordnung ausgelesen
werden kann — ihr seid zahlende Kunden, und die Zuordnung ist eure. Alternativ
ein Zugang mit POS-Berechtigung.

Notfalls ginge es auch ohne: `runner-bummer/ingredients` liefert `posRecipeName`
zusammen mit Menge, Kosten und Deckungsbeitrag, `runner-bummer/unmapped` die
Gegenliste. Über den POS-Artikelnamen ließe sich matchen — aber Namensmatching
war schon zwischen LINA und YEXT unzuverlässig, dafür gibt es
`manual.betrieb_fremd_id`. Als Notlösung tragbar, als Fundament nicht.

---

## 6. Benutzer, Rechte, Stammdaten

```
GET /api/profile                            → {id:18337, firstName, lastName, email, emailVerified}
GET /api/core/business/{userId}/restaurants → 29 Betriebe: {id, name, timezone}
GET /api/core/business/{userId}/cost-centers→ 403 für diesen Zugang
GET /api/subusers            /api/subusers/{id}
GET /api/subuser-roles       /api/subuser-roles/{id}
GET /api/subuser-permissions
GET /api/user/auth/users/{id}
```

**Der Business-Parameter ist die Benutzer-ID aus `/api/profile`** (hier 18337) —
nicht die Restaurant- oder Kostenstellen-ID. Damit ergibt sich die vollständige
Betriebsliste einer Marke aus zwei Aufrufen.

**Alle 29 Betriebe sind auf `Europe/Vienna` konfiguriert.** FoodNotify ist ein
österreichisches Produkt; die deutschen Betriebe erben die Vorgabe. Praktisch
folgenlos — Wien und Berlin haben denselben Offset und dieselben
Sommerzeitregeln — aber es steht in den Daten, und wer später eine
Zeitzonenumrechnung schreibt, sollte es gesehen haben. `businessDate` in der
Kostenanalyse ist ein zeitzonenloses Etikett, wie `geschaeftstag` bei uns.

---

## 7. Analytics ist Tableau

```
GET /api/v2/analytics   →  {"token": "<JWT>"}
```

Der Token hat `aud: tableau`, Scope `tableau:views:embed`, Laufzeit **9 Minuten**.
Das Analytics-Modul ist eine Tableau-Einbettung, kein eigenes JSON-API. Die
Angular-App lädt dafür `tableau-2.9.2.min.js`.

**Für den Import ist das eine Sackgasse**, jedenfalls auf diesem Weg. Der Token
berechtigt nur zum Einbetten von Ansichten, nicht zum Datenabruf. Was
inhaltlich zählt, liegt ohnehin in den Cost-Analysis-Endpunkten aus §2 — die
sind FoodNotifys eigenes API und liefern JSON.

---

## 7b. „Lab" — B.E.A.M., ein eigenes Produkt

Der Menüpunkt *Lab* führt nach `beam.foodnotify.com` — **eine separate Plattform
mit eigenem Login**, derzeit Beta und kostenlos.

Was sie tut: Rechnungen, Lieferscheine und Produktkataloge per OCR und KI
einlesen (Lieferant, Artikel, Preise, Einheiten, MwSt.), Produkte mit
Nährwerten, Allergenen, Verpackung und Bildern anreichern, Dubletten über
EAN → Artikelnummer → Fuzzy zusammenführen, GoBD-konform archivieren und nach
FoodNotify exportieren.

**Für unsere Fragestellung ein Detail von Gewicht:** Die Produktdatenbank führt
laut Beschreibung einen **Preisverlauf je Lieferant**. Genau das, was weder
LINAs WAWI noch FoodNotifys `prices` vorhalten — dort steht jeweils nur der
aktuelle Stand, und in `docs/datensicherung.md` ist deshalb notiert, dass die
Preisentwicklung rückwirkend nicht nachholbar ist.

Zwei Einschränkungen: Es ist ein Onboarding-Werkzeug — die Historie entsteht
erst, wenn man Belege einspeist, nicht rückwirkend aus euren Altdaten. Und es
ist ein weiterer Zugang, ein weiteres Beta-Produkt, eine weitere Abhängigkeit.

Ohne Anmeldung dort ist kein API zu inventarisieren. **Wenn ihr den Einkauf
ernsthaft auswerten wollt, ist ein Blick darauf trotzdem lohnend** — dann aber
als eigene Entscheidung, nicht als Nebenprodukt dieses Imports.

## 8. Menu Creator

```
GET /api/menu_creator            /menu_card /template /mc_images /mc_trans
GET /api/menucreator/{id}/generate-embedded-url
```

Für die Auswertung uninteressant, der Vollständigkeit halber notiert.

---

## 8a. Kritischer Befund: die Verkaufsverarbeitung ist defekt

```
GET /api/{erpId}/sales?page=1&page_size=25&order_by=timeCreated&order_direction=DESC
GET /api/{erpId}/stock/change/notification/types
GET /api/{erpId}/product-unit
```

`/sales` sind die aus dem Kassensystem übernommenen Verkäufe — `saleType.name`
lautet **`amadeus`**, es ist also derselbe Datenstrom, den wir aus LINA kennen.
Über diese Verkäufe rechnet FoodNotify den Warenverbrauch aus den Rezepturen ab.

**Sie werden nicht verarbeitet.** Jeder geprüfte Datensatz steht auf
`saleStatus: init`, `sumPrice: 0`, und trägt in `finishError`:

```
SQLSTATE[42703]: Undefined column: 7
ERROR: column t0.root_recipe_id does not exist
LINE 1: ... AS db_custom_38, t0.price_type AS price_type_39, t0.root_re...
```

Ein Datenbankfehler auf FoodNotify-Seite — eine Spalte, die der Code erwartet
und das Schema nicht hat. Stichprobe bei Wilma Wunder, 8 Kostenstellen:

| Kostenstelle | Verkäufe | Stichprobe | mit Fehler |
|---|---|---|---|
| Bar Dresden | **123.786** | 25 | **25** |
| Bar Freudenstadt | 3.971 | 25 | **25** |
| sechs weitere | 0 | — | — |

**Wo Verkäufe ankommen, scheitern 100 % der Stichprobe.**

### Warum das alles erklärt

Das ist mit hoher Wahrscheinlichkeit die Ursache für die kaputten Soll-Werte in
der Kostenanalyse. Bei Wilma Wunder steht einem Ist-Wareneinsatz von
**1.605.417 €** ein theoretischer von **55.331 €** gegenüber — 0,54 % des
zugeordneten Umsatzes. Das ist kein Pflegeproblem und keine Frage der
Rezepturqualität: **die Kette Verkauf → Rezeptur → Warenverbrauch bricht vor der
Rezeptur ab.**

Damit ändert sich die Bewertung aus dem vorherigen Abschnitt. Ich hatte die
niedrigen Soll-Werte als mangelnde Datenpflege bei Concept Family gedeutet. Nach
diesem Befund ist es zumindest überwiegend ein **Fehler im Produkt**.

### Was daraus folgt

1. **An FoodNotify melden**, mit dem Fehlertext und den betroffenen
   Kostenstellen. Das ist ein konkreter, reproduzierbarer Produktionsfehler, kein
   Wunsch. Solange er besteht, ist jede Soll-Ist-Auswertung in FoodNotify wertlos —
   auch die, die eure Leute in der Oberfläche sehen.
2. **Nicht importieren, bevor er behoben ist.** Wir würden Nullwerte einlesen und
   ihnen später glauben.
3. Der Befund ist auch ein Argument für die eigene Datenhaltung: Er ist nur
   aufgefallen, weil wir in die Rohantwort geschaut haben. In der Oberfläche
   erscheint schlicht eine niedrige Zahl.

---

## 8b. Datenlage: drei Marken im Vergleich

Am 27.07.2026 zusätzlich die Marke **Deutsche Konzepte** geprüft
(`Admin.foodnotify.deutsche@enchilada-gruppe.de`, 32 Kostenstellen). Das Bild
unterscheidet sich deutlich — und beide Marken sind auf unterschiedliche Weise
lückenhaft.

**Alle vier Marken, die FoodNotify nutzen.** Damit ist die Erhebung vollständig.

| | Enchilada | Deutsche Konzepte | Wilma Wunder | Aposto |
|---|---|---|---|---|
| Kostenstellen | 58 | 32 | 35 | 27 |
| POS-Umsatz | 3.049.801 € | 2.783.772 € | **19.735.349 €** | 762.455 € |
| davon zugeordnet | **44 %** | **73 %** | **52 %** | **49 %** |
| Speisen / Getränke | — | — | 6.082.721 / 4.178.999 € | 327.170 / 49.140 € |
| Ist-Wareneinsatz | −30,50 € | 108.567 € (5,36 %) | 1.605.417 € (15,64 %) | **−10.036.635 € (−2667 %)** |
| Soll-Wareneinsatz | 0 € | 95.663 € (4,72 %) | 55.331 € (0,54 %) | 5.873 € (1,56 %) |
| Betriebe mit Kostenanalyse | 1 von 58 | 1 von 32 | **10 von 35** | 1 von 27 |
| Monate mit Daten | — | 6 | **29, ab 2020-09** | 6, ab 2021-11 |
| Inventuren | ~70 | 9 | **275** (154 signiert) | 19 (14 signiert) |
| Inventurjahre | 2026 | 2025–26 | 2025 · 113, 2026 · 162 | 2025 · 6, 2026 · 13 |
| **Bestellungen** | nicht gemessen | 967 | nicht gemessen | **11.578** |
| Kostenstellen mit Bestellungen | — | 2 von 12 tragend | — | **26 von 26** |
| **Älteste Bestellung** | — | 19.12.2021 | — | **15.10.2021** |
| Verkäufe | — | — | 127.757 (Stichprobe) | 20.157 |
| davon mit Fehler | — | — | **100 %** | **100 %** |

### Zwei Marken, zwei verschiedene Stärken

**Aposto ist die Marke für die Einkaufsseite.** 11.578 Bestellungen, **alle 26
Kostenstellen bestellen**, älteste vom 15.10.2021. Das ist die einzige Marke mit
flächendeckender Bestellhistorie — bei Deutsche Konzepte trugen zwei von zwölf
Kostenstellen fast alles. **Damit ist die Margenfrage für Aposto vollständig
beantwortbar: vier Jahre Einkaufspreise auf Belegebene, über alle Standorte.**

**Wilma Wunder ist die Marke für die Verbrauchsseite.** 275 Inventuren, zehn
Betriebe mit Kostenanalyse, Daten bis September 2020.

### Die Kostenanalyse ist unbrauchbar, nicht nur unvollständig

Aposto weist einen Ist-Wareneinsatz von **minus 10.036.635 €** aus — bei
762.455 € Umsatz. Das sind −2667 %. Es ist kein knapper Wert und kein
Rundungsproblem, sondern offensichtlicher Unsinn.

Zusammen mit Enchiladas −30,50 € und Wilma Wunders 0,54 % Soll-Wareneinsatz
ergibt das ein klares Bild: **Die Kennzahlen der Kostenanalyse sind in keiner der
vier Marken belastbar.** Wer diese Zahlen heute im FoodNotify-Dashboard
ansieht, sieht Phantasiewerte — ohne Warnung, ohne Hinweis.

Die Ursache steht in §8a: Die Verkaufsverarbeitung scheitert an einem
Datenbankfehler, und zwar in **100 % der Stichproben bei beiden geprüften
Marken**.

### Was daraus folgt

**Die Bestellhistorie reicht über vier Jahre zurück.** Das ist die Antwort auf
die Margenfrage: Einkaufspreise auf Belegebene sind seit Dezember 2021
vorhanden. Weder LINAs WAWI noch FoodNotifys Warenstamm halten so etwas vor —
die kennen nur den aktuellen Stand. Hier entsteht die Historie aus den
Bestellungen selbst.

**Aber die Abdeckung ist extrem ungleich.** Über zwölf geprüfte Kostenstellen:

```
B+L Pforzheim Bar          486 Bestellungen   ab 2022-06
Alter Kranen Küche         370               ab 2022-03
B+L Pforzheim Küche         55               ab 2022-11
Lehner´s Rastatt Bar        22               ab 2022-03
Lehners HN Küche            13               ab 2021-12
Lehners HN Bar               8               ab 2021-12
Alter Kranen Bar            10               ab 2022-03
drei weitere                 1               2023-11
zwei weitere                 0               —
```

Zwei Kostenstellen tragen fast alles. Der Rest bestellt nicht über FoodNotify
oder hat vor Jahren aufgehört. **Eine flächendeckende Preisentwicklung über alle
Betriebe gibt es nicht** — für einzelne Betriebe dagegen sehr wohl, und dort
über vier Jahre.

**Die Inventuren sind hier noch dünner als bei Enchilada**: neun insgesamt,
davon fünf storniert, drei signiert. Über 32 Kostenstellen und zwei Jahre.
Inventurgestützte Schwundrechnung ist damit nicht möglich.

**Die Kostenanalyse liefert erstmals echte Zahlen** — aber mit einem Vorbehalt,
der wichtig ist: Ist-Wareneinsatz 5,36 %, Soll 4,72 % **des zugeordneten
Umsatzes**. In der Gastronomie liegen Wareneinsatzquoten normalerweise bei
25–33 %. Diese Werte sind also um den Faktor fünf zu niedrig, um den
tatsächlichen Wareneinsatz abzubilden — sie erfassen offenbar nur den Teil, für
den Rezeptur *und* Preis *und* Zuordnung vollständig gepflegt sind.

**Die Prozentwerte sind damit nicht verwendbar.** Die absolute Differenz
zwischen Ist und Soll (12.904 €) ist das brauchbarere Signal, und auch die
gehört gegen eine bekannte Größe geprüft, bevor jemand daraus eine Maßnahme
ableitet. Das ist derselbe Fehler, der uns bei LINA fast unterlaufen wäre
(45,90 statt 23,64) — nur andersherum.

### Und ein technischer Unterschied, der den Importer betrifft

Dieselben Endpunkte liefern **je nach Marke und Endpunkt drei verschiedene
Hüllen**:

```
flach:        {order_by, current_page, page_count, total_count, data, …}
payload:      {errors, payload:{…, data}, code, isError}
nur data:     {data:{…}}
```

Ich bin bei Wilma Wunder selbst darauf hereingefallen: Der erste Durchlauf meldete
null Inventuren und keine Kostenanalyse — tatsächlich waren es 275 Inventuren und
19,7 Mio. € Umsatz, mein Auspacken hat nur die falsche Ebene gegriffen. **Der
Fehler war lautlos**: keine Ausnahme, kein Statuscode, nur leere Ergebnisse.

Der Transformationslayer muss `payload` und `data` rekursiv auflösen und **bei
leerem Ergebnis lauter scheitern als bei einem Fehler**. Für den Importer heißt
das konkret: eine Antwort mit HTTP 200 und null Zeilen gehört als Auffälligkeit
nach `sync.schema_abweichung`, nicht stillschweigend als „keine Daten" quittiert.

---

## 9. Mengengerüst je Marke

| Aufgabe | Anfragen |
|---|---|
| Rezeptliste, 74 Seiten à 25 | 74 |
| Zutaten je Rezept | 1.846 |
| `meta` je Rezept (optional) | 1.846 |
| Inventuren, über `erpIds[]` gebündelt | wenige |
| Bestellungen, 58 Kostenstellen × Seiten | einige hundert |
| Cost-Analysis-Auswertungen | wenige |

Bei 20–40 s Takt sind allein die Zutaten **rund 15 Stunden je Marke**. Einmalig;
danach reicht ein Abgleich über `timeModified`. Bei vierzehn Marken entsprechend
mehr — **falls** die Rezepturen je Marke getrennt gepflegt werden, was noch
ungeklärt ist.

`/api/recipes/batch` könnte das um eine Größenordnung senken. Methode ungeprüft,
weil vermutlich POST — und POST habe ich nicht angefasst.

---

## 9b. Was ich nach vier Marken empfehlen würde

**Erstens: den Fehler melden, bevor irgendetwas gebaut wird.** Die
Verkaufsverarbeitung scheitert in 100 % der Stichproben mit einem
Datenbankfehler, und daran hängt die gesamte Soll-Wareneinsatzrechnung. Bis das
behoben ist, wäre jeder Import dieser Kennzahlen ein Import von Nullwerten und
Phantasiezahlen. Der Fehlertext, die Kostenstellen und die betroffenen Marken
stehen in §8a — das reicht für ein Support-Ticket.

**Zweitens: mit den Bestellungen anfangen, nicht mit der Kostenanalyse.** Sie
sind die einzige Datenquelle in FoodNotify, die nachweislich vollständig, tief
und über alle Standorte gepflegt ist — jedenfalls bei Aposto. Sie beantworten
die Frage, mit der dieses Thema angefangen hat: wie sich Einkaufspreise und
damit Margen über die Jahre entwickeln. Dafür braucht es weder das
POS-Mapping noch funktionierende Rezepturen.

**Drittens: die Rezepturen sichern.** Sie sind in allen Marken vollständig, sie
sind das, was aus LINA nicht zu holen war, und sie ändern sich selten. Ein
einmaliger Backfill, danach Abgleich über `timeModified`.

**Viertens: Inventuren und Kostenanalyse zurückstellen.** Bei Wilma Wunder
lohnen die Inventuren einen zweiten Blick (275 Stück, 154 signiert), bei den
anderen drei Marken gibt es sie praktisch nicht. Die Kostenanalyse erst nach
dem Fehler aus §8a.

**Fünftens: nicht auf vierzehn Marken planen.** Es sind vier, die FoodNotify
nutzen — Enchilada, Deutsche Konzepte, Wilma Wunder, Aposto. Das reduziert das
Mengengerüst aus §9 auf ein Viertel der ursprünglichen Annahme.

---

## 10. Offene Punkte

1. **POS-Account-ID beschaffen.** Ohne sie keine Verknüpfung zu den LINA-Verkäufen. Höchste Priorität.
2. **Zeitparameter der Cost-Analysis-Endpunkte.** `from/to` und `dateFrom/dateTo` werden ignoriert.
3. **2FA-Status der vierzehn Zugänge.** Falls aktiv, ist automatisiertes Anmelden nur mit einem dafür vorgesehenen Zugang lösbar.
4. **Sind Rezepturen markenübergreifend?** Entscheidet über Faktor 1 oder 14 beim Backfill.
5. **Zeittiefe** von Bestellungen und Inventuren nicht gemessen.
6. **`artikelId` in den Zutaten ↔ `core.artikel.artikelnummer`** — passt das zusammen?
7. **`/api/recipes/batch`** — Methode und Nutzen.
8. **`/api/foodNotify/ep/`** — Namensraum aus dem Angular-Bundle, nicht untersucht.

---

## 11. Nebenbefunde

**Datenpflege.** Nur 44 % des Kassenumsatzes sind einem Rezept zugeordnet, die
Kostenanalyse liefert für 57 von 58 Kostenstellen nichts. Bevor hier importiert
wird, lohnt die Frage, ob das Modul überhaupt in Betrieb ist. Ein Import leerer
Tabellen kostet Zeit und erzeugt Vertrauen in Zahlen, die keine sind.

**Auskunftsfreudige Fehlerseiten.** Ein 405 liefert den vollständigen
Symfony-Stacktrace mit absoluten Serverpfaden und Release-Zeitstempel. Kein
Loch, aber unnötig. Gehört in dieselbe sachliche Meldung an den Anbieter wie der
LINA-Befund.

**Sammelkonto je Marke.** Der Zugang läuft auf `Admin.foodnotify@enchilada.de` —
ein geteiltes Administratorkonto. Für einen Importer wäre ein eigener,
lesender Subuser sauberer; `/api/subusers` und `/api/subuser-roles` zeigen, dass
FoodNotify das unterstützt. Das würde auch die 2FA-Frage entschärfen.
