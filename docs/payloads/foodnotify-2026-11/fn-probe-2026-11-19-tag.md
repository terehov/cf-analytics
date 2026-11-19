# FoodNotify: Leseprobe `fn-probe` am Tag, 19.11.2026 (Wilma Wunder)

Nachtrag zu `fn-probe-2026-11-19.md`. Dort lief `link-targets` zweimal in die 120-Sekunden-Grenze und die
Warenstamm-Seitengröße war nicht gemessen. Beides jetzt nachgeholt.

Gemessen am 19.11.2026 um **06:12 UTC** mit

```
bun run fn-probe --marke wilma_wunder --nur link-targets,warenstamm --anbindung 2052 --erp 11035 --seitengroessen --max-aufrufe 10
```

Cookie-Sitzung des Importer-Zugangs, **nur GET** auf der Erlaubtliste, **ein Lauf, vier Aufrufe**, Anmeldung beim
ersten Versuch, kein 401, kein 429, kein Timeout, kein zweiter Lauf nötig. Gesamtdauer 13 s. Rohantworten und
Zusammenfassung: `belege/fn-probe-2026-11-19-0612/wilma_wunder/` (lokal, nicht in Git; der Ordnername trägt jetzt
die Uhrzeit, damit ein zweiter Lauf am selben Tag den ersten nicht überschreibt).

Nur Wilma Wunder, eine Anbindung (2052), eine Kostenstelle (erpId 11035).

> **Korrektur 19.11.2026: erpId 11035 ist „AAA Testrestaurant Wilma Wunder Bar".** Abschnitt 2 (Warenstamm) misst
> also ein Testrestaurant **ohne angebundenen Lieferantenkatalog**. Die Seitengröße (`page_size` angenommen,
> nicht gekappt) hält an der echten Kostenstelle 7984; **die Füllgrade und die `timeModified`-Aussage gelten nur
> für das Testrestaurant**. Echte Werte: `fn-probe-2026-11-19-echt.md`. Abschnitt 1 (`link-targets`, Anbindung
> 2052, echt) bleibt gültig.

## Aufrufe

| Nr | Pfad | Status | Bytes | ms |
|---|---|---|---|---|
| 1 | `/api/pos/mapping/2052/link-targets` | 200 | 3.060.735 | 2.029 |
| 2 | `/api/11035/products` | 200 | 27.644 | 330 |
| 3 | `/api/11035/products?page=1&page_size=100` | 200 | 138.759 | 1.046 |
| 4 | `/api/11035/products?page=1&page_size=1000` | 200 | 1.067.670 | 6.433 |

Dieselbe Antwort, die nachts zweimal nicht ankam, brauchte tagsüber **2,0 s** (am 18.11. im Browser 11 s). Ob das die
Tageszeit ist oder FoodNotifys Tagesform, ist mit einer Messung nicht zu trennen.

## 1. `link-targets` (Anbindung 2052)

* **13.265 Rezepte**, alle `recipeId` eindeutig (am 18.11.2026 waren es 13.253). Die Liste gilt für die ganze Marke,
  nicht für die Anbindung: **17 verschiedene `restaurantId`**, je 42 bis 1.166 Rezepte.
* **`ingredientCount`:** 0 → 158 (1,2 %), 1–5 → 10.503, 6–20 → 2.597, über 20 → 7.
* **`updatedAt`:** frühestens 19.10.2022, spätestens **18.11.2026 21:50** (+01:00). 4.493 Rezepte älter als zwölf
  Monate, keines ohne Datum.
* **Je Monat** (Anzahl Rezepte mit diesem `updatedAt`-Monat): 2025-12 68, 2026-01 1.015, 02 204, 03 728, 04 679,
  05 444, 06 315, 07 1.655, 08 1.043, 09 1.416, 10 1.032, 11 (bis 19.11.) 173.
* **Je Tag der letzten 14** (Datumsteil wie geliefert): 06.11. 0, 07.11. 10, 08.11. 0, 09.11. 2, 10.11. 47, 11.11. 0,
  12.11. 2, 13.11. 0, 14.11. 1, 15.11. 4, 16.11. 1, 17.11. 2, 18.11. 11, 19.11. 0.
  **Summe 14 Tage: 80** (0,6 % der Rezepte), letzte 7 Tage: 19.

**Was das für den Rezept-Umlauf (`0134`) heißt:** `updatedAt` bewegt sich — 80 Rezepte in 14 Tagen, einzelne
Tage ohne Änderung, ein Stoß am 10.11. (47). Als Filter „welche Rezepte muss der Umlauf öfter lesen" ist die Zahl klein
genug, um brauchbar zu sein (statt alle 17.700 Rezepte alle 14 Tage). **Nicht beantwortet bleibt die entscheidende
Frage:** bewegt sich `updatedAt`, wenn sich *nur eine Zutat* ändert, oder nur der Rezeptkopf? Das lässt sich aus
einer Messung nicht sehen; dazu braucht es zwei Abrufe desselben Rezepts (`raw.api_antwort`) gegen den `updatedAt`
zwischen den Abrufen. Bis dahin taugt `updatedAt` höchstens als **Zusatz** zum festen Umlauf, nicht als Ersatz.

**Gegenprobe gegen `core.zutat` — nicht möglich.** Der lokale Postgres (`localhost`, Datenbank `lina`, außerdem alle
sechs weiteren `lina*`-Klone) hat `core.rezept` und `core.zutat` mit **0 Zeilen**; `DATABASE_URL` zeigt auf die lokale
Datenbank, Produktion wurde nicht berührt. Offen: `ingredientCount` je Rezept gegen `count(*)` aus `core.zutat` und
`updatedAt` gegen `core.rezept.zutaten_geholt_am` — in Produktion zu messen, nicht aus der Agentenumgebung.

## 2. Warenstamm: Seitengröße

**Der Parameter heißt `page_size`.** Fundstellen: Panel-Produktmodul (`belege/foodnotify-inventur-2026-11-18/panel/735…js`,
`page_size` mit Standard 10 im Formular) und Brew (`fn-menue-durchgang.json`:
`/api/{erpId}/products?page=&page_size=&order_by=…`). `perPage` und `limit` gehören anderen Pfaden (Warengruppen,
Rezepte) und stehen **nicht** auf der Erlaubtliste. Aufgenommen sind genau zwei Muster:
`/api/\d+/products\?page=1&page_size=100` und `…&page_size=1000`, je mit Test.

| Angefragt | Zeilen | `current_page_size` | Seiten | gesamt | Bytes | ms |
|---|---|---|---|---|---|---|
| Standard | 20 | 20 | 38 | 746 | 27.644 | 330 |
| 100 | 100 | 100 | 8 | 746 | 138.759 | 1.046 |
| 1000 | **746** | 1000 | **1** | 746 | 1.067.670 | 6.433 |

* **`page_size` wird angenommen und nicht gekappt** (1000 geliefert, alle 746 Produkte in einer Antwort). Eine Kostenstelle
  braucht damit **einen** Aufruf statt 38 — bei 35 Kostenstellen rund 35 statt mehrerer hundert. Ob es eine Obergrenze
  über 1000 gibt, ist nicht gemessen (die größte Kostenstelle der Probe hat 746).
* Die Antwort meldet die Seitengröße selbst (`current_page_size`) und `total_count`; die Gegenprobe „vollständig
  geladen" ist `zeilen = total_count`.
* Sortierung: `order_by` leer, `order_direction` `DESC`; die Zeilen liegen nach `id` aufsteigend.

### Preisfelder und Füllgrad (page_size 1000, 746 Produkte) — **Testrestaurant**

> An der echten Kostenstelle 7984 (206 Produkte): `pricePerUnit` 52,9 %, `packagingUnit` 53,4 %, `packagingUnits`
> 52,9 % gefüllt — genau die Waren mit Lieferantenkatalog (`isOrderable`, 110 von 206); `preferredShopUnit` 0 %,
> `ingredient.artikelId` 94,2 %, `timeModified` 19.08. bis 19.11.2026. Die Tabelle darunter ist das Testrestaurant.

| Feld | gefüllt | Typ / Lesart |
|---|---|---|
| `unitPrice` | 746 (100 %) | Zahl; **das ist das Preisfeld**, bei 4 Produkten 0 |
| **`pricePerUnit`** | **0** | **bei allen 746 `null`** — ~~das im Inventar genannte Feld trägt keinen Preis~~ (Testrestaurant ohne Katalog; bei 7984 der Katalogpreis je Einheit) |
| `packagingQuantity` | 742 (99,5 %) | Zahl |
| `packagingUnit`, `packagingUnits` | **0** | ~~immer `null`~~ im Testrestaurant `null`; bei 7984 Bestelleinheiten mit Preis |
| `baseUnitQuantity`, `baseUnitUnit` | **0** | immer `null` |
| `preferredShopUnit` | 601 (80,6 %) | Text |
| `unit` | 746 | Objekt `{id, name}` |
| `unitQuantity` | 746 | Zahl |
| `timeModified` | 746 | Objekt `{date, timezone_type, timezone}` |
| `shop` / `shop.id` | 742 (99,5 %) | Objekt; bei 4 `null` |
| `ingredient.artikelId` | 742 (99,5 %) | Text; **identisch mit dem Feld `artikelId` der Zeile** (742 von 742) |

Bei 20 und 100 Zeilen sehen die Füllgrade gleich aus (95 und 99 %); `preferredShopUnit` fiel erst in der
Vollmenge auf 80,6 %.

* ~~**`timeModified` taugt nicht als Preisänderungsdatum:**~~ (gilt für das Testrestaurant; bei 7984 liegt
  `timeModified` zwischen 19.08. und 19.11.2026 — es bewegt sich, was es auslöst, ist nicht gemessen)
  650 von 746 Produkten tragen 2024 (frühestens 10.12.2024),
  83 tragen 2025, **13** tragen 2026 (zuletzt 21.10.2026). Die Standardseite zeigte dieselbe Untergrenze und als
  Obergrenze 26.11.2025 — sie liegt nicht in Änderungsreihenfolge. Ob sich der Preis (`unitPrice`) ohne
  `timeModified`-Änderung bewegt, ist nicht gemessen.
* `isOrderable` ist bei **allen** 746 `false` (Testrestaurant; bei 7984 110 von 206 `true` — die Waren mit
  Katalog), `stock` ist bei allen Zeilen vorhanden (Bestand ≠ 0 bei 87,8 %).
* ~~**Preis- und Verpackungsangabe sind für den Wareneinsatz nicht ausreichend belegt:** Eine Verpackungseinheit
  (`packagingUnit`) fehlt überall; `unitPrice` hängt an `unit`/`unitQuantity`. Wie der Preis je Basiseinheit zu
  rechnen ist, ist **nicht** gemessen — und ob er der Bestellpreis ist, gegen `core.bestellposition` zu prüfen.~~
  **Beantwortet 19.11.2026 (am Klon, Migration `0157`):** `unitPrice` ist der Preis **je Einheit** (kg, l) und
  folgt dem Preis der letzten Bestellung — an der echten Kostenstelle 7984 gegen ihre eigenen Bestellungen 141 von
  163 auf 2 %. Die Verpackungseinheit fehlt nur im Testrestaurant.

## Was offen bleibt

* `updatedAt` gegen Zutatenänderung (siehe oben) und gegen `core.zutat` (lokal leer).
* Obergrenze von `page_size` (gemessen bis 1000; größte Kostenstelle 746). Die anderen Kostenstellen und Marken sind
  nicht gelaufen.
* `unitPrice` gegen den Bestellpreis; Bedeutung von `unitQuantity` und `unit`.
* Tageszeit und Antwortzeit von `link-targets`: ein Tageswert (2 s), zwei Nachtwerte (Timeout).

## Änderungen an `fn_probe.ts` (kein Netz, getestet)

`--nur` (Fragen `bruecke, link-targets, rezeptliste, warenstamm, verkaeufe, foodwaste`), `--anbindung` und `--erp`
(feste IDs, sparen `/api/erp/all` und `/api/pos/locations`), `--seitengroessen`; Ausgabeordner
`belege/fn-probe-<UTC-Datum>-<HHMM>` (bei gleicher Minute `-2`); Zusammenfassung mit `ingredientCount`-Verteilung,
`updatedAt` je Tag und je Monat, Füllgrad der Preisfelder, `timeModified`-Spanne und gemeldeter Seitengröße.
