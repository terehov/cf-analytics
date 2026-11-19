# fn-token-probe 19.11.2026: was das Scope-Token bei allen vier Marken trägt

**Gemessen am 19.11.2026, 18:51 bis 18:53 UTC** mit `bun run fn-token-probe` (`src/fn_token_probe.ts`), aus der
Agentenumgebung. Je Marke **16 GET**, insgesamt **64**, dazu je Marke ein Anmelde-POST der Sitzung. Kein 429, kein
401, kein Abbruch, keine Zeitüberschreitung, kein zweiter Versuch. Rohantworten (geschwärzt) und die vollständige
Zusammenfassung mit Formen und Zählwerten liegen unter `belege/fn-token-probe-2026-11-19-1851/` (git-ignoriert,
nicht im Repo). Nachgeprüft: in keiner der 62 Dateien dort steht ein Token- oder Passwortwert.

## Wie gemessen wurde

* **Token** (`FN_API_TOKENS`, je Marke eins) als `Authorization: Bearer …` **nur gegen `https://api3.foodnotify.com`**.
  Je Pfad ein GET, in der **Form des Registers** (`src/foodnotify/endpunkte.ts`, die Pfade werden mit dessen
  Funktionen gebaut): also `paginate?page=1&page_size=25&order_by=timeCreated&order_direction=ASC`,
  `stocktakings?page=1&order_by=timeCreated&order_direction=ASC&erpIds%5B%5D=…`, `products?page=1&page_size=1000`.
* **Sitzung** (`my.foodnotify.com`) nur für die beiden IDs, die das Token nicht aufzählen kann: Benutzer-ID
  (`/api/profile`, in der Anmeldung) und Kassenanbindung (`/api/pos/locations`). Die Kostenstelle kam aus der
  **Token**-Antwort `/api/erp/core/{userId}/erps`; der vorgesehene Rückfall auf `/api/erp/all` war bei keiner Marke
  nötig. Die Sitzungspfade sind **nicht neu gemessen** im Sinn dieses Berichts — sie liefern nur die IDs.
* Erlaubtliste je Host, Sperrliste aus `fn_probe.ts` (die 15 GETs mit Wirkung) plus jeder Pfad mit `cart`.
  1,2 s Mindestabstand (bzw. `FN_TAKT_*`), Zeitgrenze 120 s, Kassenartikel 180 s.
* Testkostenstellen und -anbindungen übersprungen („test" im Namen): bei Aposto, Enchilada und Deutsche Konzepte je
  ein „AAA Testbetrieb/Testrestaurant", bei Wilma Wunder zwei Testanbindungen (1454, 1616) und vier
  Testkostenstellen (11035, 12066, 12601 „CF GASTRO TESTBETRIEB", 11757 „DISTRA TESTBETRIEB").
* Rezept: auf Seite 1 der Rezeptliste, nicht archiviert, laut `link-targets` mit Zutaten — bei allen vier Marken
  gefunden (am 18.11.2026 war das gemessene Wilma-Rezept leer).

| Marke | Anbindung (Kasse) | Kostenstelle (erpId) | Rezept | Bestellung |
|---|---|---|---|---|
| aposto | 2070 (amadeus) Aposto Aalen — Küche Aposto Aalen | 10117 Aposto Aalen — Küche | 1520792 | 66363 |
| enchilada | 1095 (amadeus) Enchilada Köln — Küche Enchilada Köln | 10059 Enchilada Köln — Küche | 1521756 | 70527 |
| deutsche_konzepte | 1729 (amadeus) WHK Gastronomie GmbH — Würzburger Hofbräu Küche | 12011 Würzburger Hofbräu Küche | 1520134 | 368458 |
| wilma_wunder | 2052 (amadeus) Wilma Wunder Ballplatz Mainz — Bar Ballplatz | 7984 Bar Ballplatz | 1524384 | 22104 |

Die Bestellung ist jeweils die **älteste** der Kostenstelle (Registerform sortiert aufsteigend).

## Ergebnis: Registereintrag × Marke (nur Token)

„trägt" = HTTP 200 mit JSON ohne Hüllenfehler. „trägt nicht" = 403 „This endpoint does not support scope-limited
tokens." Je Zelle **ein** Aufruf.

| Registereintrag | Pfad (Token, Registerform) | aposto | enchilada | deutsche_konzepte | wilma_wunder |
|---|---|---|---|---|---|
| `fn:profil` | `/api/profile` | nicht gemessen (18.11.: 403 bei Wilma) | nicht gemessen | nicht gemessen | nicht gemessen |
| `fn:betriebe` | `/api/core/business/{userId}/restaurants` | **trägt** (14) | **trägt** (29) | **trägt** (16) | **trägt** (18) |
| `fn:kostenstellen` | Ersatz `/api/erp/core/{userId}/erps` | **trägt** (21) | **trägt** (57) | **trägt** (30) | **trägt** (35) |
| `fn:pos_standorte` | `/api/pos/locations` | nicht gemessen (18.11.: 403 bei Wilma) | nicht gemessen | nicht gemessen | nicht gemessen |
| `fn:rezepte` | `/api/recipes?page=1` | trägt nicht | trägt nicht | trägt nicht | trägt nicht |
| `fn:rezepte` (Ersatz) | `/api/recipe-viewer/recipes?page=1` | **trägt** (966 Rezepte) | **trägt** (2.079) | **trägt** (2.001) | **trägt** (13.275) |
| — | `/api/pos/mapping/{connectionId}/link-targets` | **trägt** (965 Zeilen) | **trägt** (1.972) | **trägt** (1.992) | **trägt** (13.265) |
| `fn:rezept` | `/api/recipes/{id}` | **trägt** | **trägt** | **trägt** | **trägt** |
| `fn:rezept_zutaten` | `/api/recipes/{id}/ingredients` | **trägt**, 10 Zutaten, `artikelId` bei 8 | **trägt**, 5 / 3 | **trägt**, 7 / 7 | **trägt**, 1 / 1 |
| `fn:rezept_meta` | `/api/recipes/{id}/meta` | **trägt** | **trägt** | **trägt** | **trägt** |
| `fn:bestellungen` | `/api/{erpId}/shop-order/paginate?…ASC` (page_size 25) | **trägt** (2.078) | **trägt** (377) | **trägt** (433) | **trägt** (1.991) |
| `fn:bestellung` | `/api/{erpId}/shop-order/{orderId}` | **trägt** | **trägt** | **trägt** | **trägt** |
| `fn:bestellpositionen` | `/api/{erpId}/shop-order/{orderId}/change?order_by=name` | trägt nicht | trägt nicht | trägt nicht | trägt nicht |
| `fn:bestellansicht` | `/shop/{shopId}/orders/{nr}` (HTML, `my`) | nicht gemessen | nicht gemessen | nicht gemessen | nicht gemessen |
| `fn:inventuren` | `/api/erp/stocktakings?…&erpIds%5B%5D=…` | trägt nicht | trägt nicht | trägt nicht | trägt nicht |
| `fn:inventurpositionen` | `/api/erp/stocktakings/{uuid}/items` | nicht gemessen (keine Inventur-ID) | nicht gemessen | nicht gemessen | nicht gemessen |
| `fn:warenstamm` | `/api/{erpId}/products?page=1&page_size=1000` | **trägt** (145) | **trägt** (627) | **trägt** (333) | **trägt** (206) |
| `fn:pos_artikel` | `/api/pos/mapping/{connectionId}/articles` | **trägt** (1.157) | **trägt** (1.357) | **trägt** (438) | **trägt** (895) |

In Klammern: Zeilen bzw. `totalItems`/`total_count` der einen Antwort.

**Die vier Marken verhalten sich gleich.** Kein Pfad trägt bei einer Marke und bei einer anderen nicht. Alle drei
Abweisungen tragen dieselbe Meldung „This endpoint does not support scope-limited tokens." (119 Bytes) — es ist die
Grenze des Endpunkts, nicht ein fehlender Scope und keine Eigenheit des Wilma-Kontos.

## Was die Antworten sonst zeigen

* **Registerform mit Token angenommen.** Die Bestellliste antwortet mit `order_by` `timeCreated ASC` und
  `current_page_size` 25, wie verlangt (offen seit 18.11.2026: dort war nur `DESC` und `page_size=5` gemessen). Der
  Warenstamm meldet `current_page_size` 1000 und lieferte bei allen vier Kostenstellen alle Zeilen in einer Antwort.
* **Hüllen gleich je Pfad über alle Marken:** Bestellliste, Bestellkopf und Warenstamm in der erp-Hülle `payload`;
  Rezeptliste `{data, pagination}`; Einzelrezept, Zutaten, Meta `{data}`; `link-targets` nacktes Array;
  Kassenartikel `{location, restaurantId, items[], canCreateRecipes, ingestIssues[]}`.
* **Zutaten tragen bei allen vier Marken dieselben zwölf Felder** (`id, kind, name, quantity, unit, baseQuantity,
  baseUnit, cost, artikelId, supplier, subRecipeId, group`), `artikelId` als Text. `kind` gesehen: `ingredient`,
  `sub_recipe`, `product_group`. Ohne `artikelId`: bei Aposto die zwei `sub_recipe`, bei Enchilada ein `sub_recipe`
  und **eine `ingredient`-Zeile**; bei Deutsche Konzepte und Wilma Wunder keine.
* **Rezeptliste und link-targets zählen verschieden:** Aposto 966 gegen 965, Enchilada **2.079 gegen 1.972**
  (107), Deutsche Konzepte 2.001 gegen 1.992, Wilma Wunder 13.275 gegen 13.265. Auf Seite 1 der Rezeptliste war bei
  keiner Marke ein Rezept archiviert. Ob die Differenz archivierte Rezepte sind, ist **nicht geprüft**.
* **link-targets ohne Zutaten:** Aposto 295 von 965 (**30,6 %**), Enchilada 2,0 %, Deutsche Konzepte 0,5 %,
  Wilma Wunder 1,2 %. Verschiedene `restaurantId`: 5 / 24 / 12 / 17.
* **Kassenartikel mit Rezept** (eine Anbindung je Marke): Aposto 26,4 %, Enchilada 12,1 %, Deutsche Konzepte
  71,7 %, Wilma Wunder 49,4 % (wie am selben Tag mit der Sitzung an 2052). PLU bei allen vier Anbindungen
  vollständig numerisch.
* **Warenstamm, Katalogpreis:** `pricePerUnit` gefüllt bei Aposto 104 von 145, Deutsche Konzepte 169 von 333, Wilma
  Wunder 110 von 206 — bei **Enchilada Köln Küche 0 von 627** (auch `packagingUnit(s)` 0). Ob die Kostenstelle
  keinen Lieferantenkatalog hat, ist nicht geprüft. `unitPrice` überall voll gefüllt.
* **Wilma Wunder trifft die Messungen von 18. und 19.11.:** 895 Kassenartikel, 206 Waren an 7984, 18 Betriebe,
  35 Kostenstellen, 1.991 statt 1.988 Bestellungen (drei neue seit dem Vortag).

## Dauer und Größe

| Pfad | aposto | enchilada | deutsche_konzepte | wilma_wunder |
|---|---|---|---|---|
| `link-targets` | 0,8 s / 205 KB | 3,7 s / 431 KB | 2,6 s / 413 KB | 5,4 s / 3,1 MB |
| Warenstamm (`page_size=1000`) | 6,4 s / 794 KB | 7,4 s / 898 KB | **14,8 s / 1,8 MB** | 5,5 s / 822 KB |
| Kassenartikel | 1,1 s / 310 KB | 1,3 s / 367 KB | 0,9 s / 124 KB | 0,4 s / 246 KB |
| alle übrigen | 0,1–1,4 s | | | |

**Auffällig:** Die Kassenartikel kamen mit Token in **0,4 bis 1,3 s** — mit der Sitzung waren es am 19.11.2026
19 bis 39 s je Antwort, an denselben Wilma-Anbindungen einschließlich **2052** (2051, 2052, 2055; je Lauf brach
einer von drei ab — daher `FN_ZEITGRENZE_LANG_MS` 180 s in `0155`, `fn-probe-2026-11-19.md` §1). 2052 lieferte
beide Male 895 Artikel, mit Token in 0,4 s. Woran das liegt (Host `api3` gegen `my`, Zwischenspeicher, Tageszeit),
ist **nicht geprüft**. Eine Messung je Anbindung, kein Grund, die Zeitgrenze zu senken.

## Was nicht gemessen ist

* **Kein Zeilenvergleich Token gegen Sitzung.** Status, Form und Zählwerte, nicht dieselben Zeilen.
* `/api/profile` und `/api/pos/locations` mit Token — nicht erneut (am 18.11.2026 bei Wilma 403). Ohne sie fehlen
  dem Token weiterhin Benutzer-ID und Anbindungsliste; die Probe hat beide aus der Sitzung genommen.
* `fn:inventurpositionen` (keine Inventur-ID, weil die Inventurliste abgewiesen wird) und `fn:bestellansicht`.
* Je Marke **eine** Kostenstelle, **eine** Anbindung, **ein** Rezept, **eine** Bestellung, jeweils Seite 1.
  Folgeseiten der Rezeptliste über `recipe-viewer` sind nicht gemessen (nur `page=1` steht auf der Erlaubtliste).
* Ob die Tokens aller Marken dieselben Scopes tragen, ist nicht abgefragt (`grantable-scopes` nicht aufgerufen);
  gleiche Ergebnisse an 14 Pfaden sprechen dafür, belegen es nicht.
