# FoodNotify: Leseprobe an einer echten Kostenstelle, 19.11.2026 (Wilma Wunder, Bar Ballplatz Mainz)

Nachtrag zu `fn-probe-2026-11-19.md` und `fn-probe-2026-11-19-tag.md`. Dort waren Warenstamm, Verkäufe und Food Waste
an **11035/12066 „AAA Testrestaurant Wilma Wunder"** gemessen — die Probe hatte die ersten Kostenstellen aus
`/api/erp/all` genommen (`docs/fehlerkatalog.md`, 19.11.2026). Hier dieselben Fragen an einer echten Kostenstelle.

Gemessen am 19.11.2026 um **07:29 UTC** mit `bun run fn-probe --marke wilma_wunder --nur verkaeufe,warenstamm,foodwaste
--erp 7984 --seitengroessen`, Cookie-Sitzung des Importer-Zugangs, **nur GET** auf der Erlaubtliste, **9 Aufrufe, alle
HTTP 200**. Rohantworten und Zusammenfassung: `belege/fn-probe-2026-11-19-0729/wilma_wunder/` (lokal, nicht in Git).

erpId **7984** = Kostenstelle 7911 „Bar Ballplatz", Restaurant „Wilma Wunder Ballplatz Mainz" (Betrieb Wilma Wunder Ballplatz Mainz GmbH).

## Aufrufe

| Nr | Pfad | Status | Bytes | ms |
|---|---|---|---|---|
| 1 | `/api/7984/products` | 200 | 58.882 | 664 |
| 2 | `/api/7984/products?page=1&page_size=100` | 200 | 288.347 | 1.849 |
| 3 | `/api/7984/products?page=1&page_size=1000` | 200 | 813.067 | 4.634 |
| 4 | `/api/7984/sales` | 200 | 4.307 | 289 |
| 5 | `/api/7984/sales/43077976/recipe-sale` | 200 | 5.396 | 181 |
| 6 | `/api/7984/sales/43077981/recipe-sale` | 200 | 3.459 | 175 |
| 7 | `/api/analytics/reports/cost-analysis/ingredients/food-waste` | 200 | 339.119 | 486 |
| 8 | `/api/erp/food-waste?erpId=7984&limit=5&page=1` | 200 | 84 | 138 |
| 9 | `/api/erp/food-waste-alpha/totals?erpId=7984` | 200 | 50 | 128 |

## 1. Warenstamm

* **206 Produkte, `page_size=1000` liefert alle in einem Aufruf** (813 KB, 4,6 s; Standard 20 je Seite = 11 Seiten,
  100 = 3 Seiten). `current_page_size` meldet 1000, `page_count` 1, `total_count` 206 — die Seitengröße hält.
* **Anders als im Testrestaurant hängt ein Lieferantenkatalog dran.** Die 110 Waren mit `isOrderable = true` tragen
  `productForShow` (das Katalogprodukt), 109 davon `pricePerUnit {quantity: 1, unit: "KG"|"L", price}`, 110
  `packagingUnit {name, label, quantity, price {amount, currency}}` (8 ohne Preis) und `packagingUnits[]` (meist
  eine Bestelleinheit, sechsmal zwei). Bei den 96 übrigen sind alle vier Felder `null`.
* **Füllgrade (page_size 1000):** `unitPrice` 100 %, `unitQuantity` 100 %, `packagingQuantity` 97,1 % (200, sonst
  Eigenproduktion), `pricePerUnit` 52,9 %, `packagingUnit` 53,4 %, `packagingUnits` 52,9 %, `preferredShopUnit` 0 %,
  `baseUnitQuantity`/`baseUnitUnit` 0 %, `shop` 97,1 %, `ingredient.artikelId` 94,2 %, `timeModified` 100 %.
  Einheiten: `l` 115, `kg` 81, `baseUnit` 10. Kein Produkt mit `unitPrice = 0`.
* **Schlüssel:** `id` 206 von 206 eindeutig. `artikelId` 200 gefüllt, davon 6 leer (`""`, Kleinlieferanten wie
  „Wilmas Zauberladen", ein Weingut); die 194 Nummern sind eindeutig, Lieferant + Nummer ebenso. 6 Produkte ohne
  Lieferant sind Eigenproduktion (`recipeProduct`, Namen „BA_…"). 14 Lieferanten.
* **`pricePerUnit.price` gegen `unitPrice`:** gleich bei 105 von 109 (0,5 %). In den vier anderen liegt der Katalog
  **darunter** (−1,6 bis −8,5 %), und dreimal ist `unitPrice` genau der Preis je Einheit der letzten eigenen
  Bestellung (Klon, Bestand bis 02.08.2026) — der Katalog hat sich bewegt, der Warenstamm folgt erst der nächsten
  Bestellung.
* **Gebinde:** `unitPrice × unitQuantity × packagingQuantity` trifft bei 96 von 110 Katalogwaren einen Preis aus
  `packagingUnits` (1 %), `pricePerUnit.price × unitQuantity` bei 100 — `unitQuantity` ist der Inhalt einer
  Bestelleinheit in kg/l (Tee „15 x 3 g" im Karton 6: 0,27 kg).
* **`timeModified`** liegt zwischen 19.08.2026 19:31 und 19.11.2026 00:09 (40 Produkte am 19.08., 37 am 15.11.) — es
  bewegt sich, anders als im Testrestaurant (dort meist 2024). Was es auslöst (Preis, Bestand, Pflege), zeigt eine
  einzelne Antwort nicht; das misst erst der Vergleich zweier Nächte in `raw`.
* `stock.sumPrice = stock.sumAmount × unitPrice` nur bei 69 von 206 (Testrestaurant 743 von 746) — FoodNotify
  bewertet den Bestand eigen. `stock.shouldUpdatePrice` überall `false`.

**Gegenprobe gegen die Bestellungen** (lokaler Klon, Kostenstelle 7984 = `core.kostenstelle` 120, 1.894 Bestellungen
bis 02.08.2026; letzte eigene Bestellung je Lieferant + Nummer, ohne Stornos): 163 der 194 Waren mit Nummer gefunden.
`unitPrice` trifft den Preis je Basiseinheit der letzten Bestellung bei **141**, den Gebindepreis (`einzelpreis`) bei
28 — bei Inhalt ≠ 1 sind es **111 gegen 2**. Seit Juni 2026 bestellt: **99 von 106**. `pricePerUnit.price` trifft den
Preis je Einheit der letzten Bestellung bei 96 von 103 (seit Juni 79 von 85).

**Lader (`0157`) gegen diese Antwort, am Klon:** 206 Produkte in 25 ms, Abzug vollständig, 109 Katalogpreise, 200
Lieferanten über `core.lieferant` aufgelöst, `mart.warenstamm_stand` = `ok`, Neuaufbau aus `raw` identisch.

## 2. Verkäufe — der Verkaufsimport läuft

* `/api/7984/sales`: **21.362 Verkäufe** (2.137 Seiten zu 10), die zehn jüngsten vom **18.11.2026**, alle
  `saleStatus: finish`, `finishError` 0.
* `recipe-sale` für zwei Verkäufe: 6 von 6 und 4 von 4 Positionen mit Rezept und `recipeIngredients`.
* Damit ist **„der Verkaufsimport steht seit 31.08.2026" widerlegt** — das galt nur für das Testrestaurant, in dem
  nicht verkauft wird. Verkäufe als Quelle für den Soll-Verbrauch sind wieder offen und prüfenswert
  (`docs/offene-punkte.md`, 18.11.2026, Punkt 13). Eine Kostenstelle gemessen; die übrigen nicht.

## 3. Food Waste

* Kostenanalyse (ohne Parameter, markenweit): 1.986 Zeilen, 13 `restaurantId`, 18.09.2020 bis 19.11.2026, Summe
  `totalWasteValue` −1.276.194,18 (Vorzeichen weiter ungeklärt).
* Liste und Summen für 7984: leer (0 Zeilen, `totalPrice` 0) — die neue Food-Waste-Erfassung wird auch hier nicht
  benutzt.

## Was offen bleibt

* Die anderen 30 echten Kostenstellen von Wilma Wunder und die anderen drei Marken.
* Ob `timeModified` sich mit dem Preis bewegt — aus zwei Nächten `raw` nach dem Deploy von `0157` messbar.
* Wovon der Katalog (`pricePerUnit`) abhängt, wenn ein Lieferant mehrere Kostenstellen beliefert.
