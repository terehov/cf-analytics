# FoodNotify: Warenkorb und Verkäufe in der Tiefe, 19.11.2026 (Wilma Wunder)

Zwei lesende Messungen, vom Nutzer am 19.11.2026 freigegeben. Nur Marke `wilma_wunder`, nur echte Kostenstellen,
nur GET über `src/fn_probe.ts` (feste Erlaubtliste), Cookie-Sitzung des Importer-Zugangs, **tagsüber** (09:09–09:11 UTC,
10:09–10:11 Berliner Zeit). Rohantworten lokal unter `belege/fn-probe-2026-11-19-0909/` (Warenkorb-Liste),
`…-0909-2/` (Stufe eins) und `…-0910/` (Verkaufstiefe) — nicht in Git. Namen von Mitarbeitenden und Gästen stehen
hier nicht; Betriebs- und Lieferantennamen sind Geschäftsdaten.

## Kurzfassung

1. **Der Warenkorb-GET verändert den Warenkorb.** Ein einziges Lesen eines Entwurfs hat dessen `timeUpdated` von
   01.03.2026 08:40 auf den Lesezeitpunkt (19.11.2026 10:09:56 Berliner Zeit, zwei Sekunden nach dem GET) gesetzt und
   `deliveryDateUpdated: true` geliefert, `deliveryDate` steht danach auf dem frühestmöglichen Termin (20.11.2026).
   **Es ist der fünfzehnte GET mit Wirkung.** Messung 1 wurde nach diesem einen Warenkorb **sofort abgebrochen**, kein
   zweiter und dritter Warenkorb gelesen. Der Pfad ist jetzt in `src/fn_probe.ts` gesperrt.
2. **Was der eine Warenkorb an Konditionen sagt** (Distra GmbH, Shop 567, Bar Hannover — ein Betrieb, der inzwischen
   geschlossen ist): Mindestbestellwert **0 EUR**, wählbare Liefertermine **Montag bis Samstag** ab dem nächsten Tag,
   keine gesperrten Tage, keine Bestellfrist je Artikel (`preorderDays` leer). Das ist **nicht** der Tourenplan: dieselbe
   Kostenstelle bestellte seit September 2025 nur noch mittwochs.
3. **Ein „Verkauf" ist ein Kassenvorgang (Bon), keine Tageszeile und kein Importpaket.** 3 von 3 Kostenstellen:
   alle `finish`, kein Fehler. Aber: **Bar und Küche desselben Betriebs tragen dieselben Bons** (Doppelzählung), **jeder
   vierte Verkauf am Ballplatz ist ein negativer Gegenbon**, und die Position trägt **keine Kassen-PLU**, nur die Rezept-ID.
4. **Ein Rückblick über zwölf Monate gibt es nicht** — die Historie beginnt mit der Anbindung (12.08. bzw. 15.09.2026).
   Dafür kostet **ein täglicher Import rund 130 bis 270 Aufrufe je Kostenstelle**, fast alle für die Positionen
   (ein Aufruf je Verkauf).

## Aufrufe (alle 200)

| Lauf (UTC) | Nr | Pfad | Bytes | ms |
|---|---|---|---|---|
| 09:09:39 Stufe liste | 1 | `/api/carts/all?page=1&limit=50` | 15.537 | 135 |
| 09:09:54 Stufe eins | 1 | `/api/carts/all?page=1&limit=50` | 15.537 | 137 |
| | 2 | `/api/shop/567/cart/draft/28093` | 1.401 | 183 |
| | 3 | `/api/carts/all?page=1&limit=50` (nachher) | 15.537 | 133 |
| 09:10:34 Verkaufstiefe | 1 | `/api/erp/all` | 4.553 | 146 |
| | 2 | `/api/7984/sales?page=1&page_size=1000&order_by=timeSold&order_direction=DESC` | 413.201 | 837 |
| | 3 | `/api/7984/sales?page=1&page_size=1&order_by=timeSold&order_direction=ASC` | 602 | 150 |
| | 4 | `/api/7984/sales/43081793/recipe-sale?page=1&page_size=100` | 1.227 | 238 |
| | 5 | `/api/7984/sales/43002582/recipe-sale?page=1&page_size=100` | 65.057 | 400 |
| | 6–9 | dasselbe für 9444 (Küche Ballplatz) | 413.267 / 614 / 1.227 / 65.452 | 832 / 160 / 168 / 448 |
| | 10–13 | dasselbe für 10772 (Bar Karlsruhe) | 412.565 / 613 / 26.726 / 26.617 | 891 / 148 / 387 / 309 |

Die Stufen `eins`/`weitere` des Skripts sind nach dieser Messung entfernt (`docs/entscheidungen.md`, 19.11.2026); `--nur warenkorb` liest nur noch die Liste. Warenkorb gesamt 4 Aufrufe (Obergrenze 8), Verkäufe 13 (Obergrenze 30), ein Lauf. Die Anmeldung gelang beim ersten
Versuch, je Lauf einmal. Neue Erlaubtliste: `page_size=1000` + `order_by=timeSold&order_direction=DESC`, dieselbe Form mit
`page_size=1` und `ASC` (ältester Verkauf), `recipe-sale?page=1&page_size=100`, die Warenkorb-Listen
`/api/carts/{all|active}?page=1&limit=50` (`active` am 18.11. mit `limit=5` gemessen, `all` am 19.11.).

## Messung 1 — Warenkorb

### Die Liste (Stufe 1, 09:09 UTC)

* **37 Warenkörbe** (`totalResults` 37, eine Seite): 24 `active`, 12 `draft`, 1 `faulty`. **9 davon gehören zu
  Testkostenstellen** (AAA Testrestaurant, DISTRA TESTBETRIEB) und wurden nie gelesen.
* Felder: `cartId, shopId, shopName, restaurantId, restaurantName, costCenterId, costCenterName, type, productCount,
  cartTotal, currency, logo, timeUpdated`. **Keine Konditionsfelder** (`minimalOrderSum`, `deliveryDate` …) — die stehen
  nur im Detail.
* Lieferanten in der Liste: Distra GmbH (Shop 567) in 19 von 37, Wilmas Zauberladen 3, CF Gastro 2, je einer: Heimerl,
  J.J. Darboven, CHEFS CULINAR, GGS, Layer-Chemie, IFBI, FFD, Getränke Klumpp, ADAM Getränke, Broscheit, Eierhof Engl.
* Die Änderungsdaten reichen vom 19.11.2026 09:56 (Küche Nürnberg, Distra) bis 22.10.2023. **Den ältesten Entwurf
  ohne Testkostenstelle** lieferte `567/draft/28093` (Distra GmbH, Bar Hannover, zuletzt 01.03.2026, ein Produkt, 53,92 EUR) —
  ein Entwurf eines **inzwischen geschlossenen** Betriebs, also der am wenigsten in Arbeit befindliche.

### Der eine Warenkorb (Stufe eins, 09:09:54 UTC) — und die Nebenwirkung

Vorher/Nachher der Liste (37 Einträge, Vergleich aller Felder jedes Eintrags): **genau ein Eintrag hat sich verändert,
der gelesene.**

| Feld | vorher (erste Liste) | nachher (zweite Liste) |
|---|---|---|
| `timeUpdated` | 2026-03-01 08:40:53 | **2026-11-19 10:09:56** |
| `deliveryDate` im Detail | nicht erfasst | 2026-11-20 (frühestmöglicher Termin) |
| `deliveryDateUpdated` im Detail | — | **true** („Lieferdatum wurde auf das Ehestmögliche verschoben") |

**Schluss: Ja, das Lesen schreibt** — der Server prüft beim GET den gespeicherten Liefertermin, verschiebt ihn bei
Ablauf auf den frühestmöglichen und speichert das (samt `timeUpdated`). Nicht erfasst ist der Liefertermin **vor** dem
Lesen (die Liste trägt ihn nicht, ein Vorabruf des Details wäre derselbe Schreibzugriff). Was **nicht** passiert ist:
keine Bestellung, keine Positionen, keine Preise, kein anderer Warenkorb verändert. Der Warenkorb gehört dem
Importer-Konto nicht; die Änderung ist eine verschobene Lieferdatumsangabe in einem acht Monate alten Entwurf eines
geschlossenen Betriebs. Nicht umkehrbar (nur lesender Zugriff; Rückgängig hieße schreiben).

**Messung 1 wurde deshalb nach Stufe 2 beendet** (Vorgabe: bei `deliveryDateUpdated` wahr oder Änderung der Liste
sofort aufhören). Stufe 3 (zwei weitere Lieferanten) ist **nicht gelaufen**.

### Was der eine Warenkorb trotzdem zeigt (Distra GmbH, Shop 567, Bar Hannover)

* `minimalOrderSum` **0**, `currency` EUR. Kopffelder: `cartId, costCenterId, currency, deliveryDate, deliveryDateUpdated,
  deliveryDates, enableComments, minimalOrderSum, net, numberOfProducts, restaurantId, shop, shopid` (so, klein
  geschrieben), `total, type, unavailableDeliveryDates, vat, products`.
* **`deliveryDates`: 14 Termine, 20.11.–05.12.2026** (16 Kalendertage, davon die zwei Sonntage 22. und 29.11.
  ausgelassen): Mo 2, Di 2, Mi 2, Do 2, Fr 3, Sa 3, So 0. **`unavailableDeliveryDates`: 0.** Der erste Termin ist der
  Folgetag (Abruf Do 19.11. 10:09 Berliner Zeit).
* **`preorderDays`: bei dem einen Produkt `null`** — für Distra gibt es keine Bestellfrist je Artikel. (Die Form
  `{passed, orderableUntil, available_from, desiredDeliveryDate}` aus dem Bundle bleibt **ungemessen**; sie kommt
  vermutlich bei Lieferanten mit Vorlauf vor.)
* Das Produkt trägt `artikelId`, `packagingUnit(s)`, `cartPrice`, `priceChanged`, `whitelisted`, `available`,
  `extIngredientPackagingQuantity/Unit` — Positionen und Preise wurden nicht übernommen.

### Gegen das beobachtete Verhalten (lokaler Klon, Stand Migration `0101`)

`core.bestellung` (lokal) für Bar Hannover (erpId 10813) × Distra (`fn_id 567`): 174 Bestellungen bis 24.02.2026;
Liefertag **korrigiert** gerechnet (lokal noch ohne `0156`, also `geliefert_am + 1`). Die letzten zwölf Monate vor der
Schließung: **Mittwoch 20, Dienstag 1.** Vor September 2025: Freitag 89, Mittwoch 33, Montag 25, Dienstag 19, Donnerstag 5,
Samstag 2 (kein Sonntag). Distra über alle Wilma-Kostenstellen: Do 1.146, Mo 1.141, Mi 631, Fr 554, Di 397, Sa 266,
So 1.

**Das beobachtete Verhalten ist eine echte Teilmenge der wählbaren Termine: jeder beobachtete Liefertag steht im
Kalender (Mo–Sa), aber der Kalender nennt nicht, welche Tage der Betrieb tatsächlich beliefert wird.** Die wählbaren
Termine sind, was der Lieferant für den Warenkorb *anbietet* — bei Distra Mo–Sa an jeder Kostenstelle —, nicht der Tourenplan
(Hannover: mittwochs). Damit stützt die Messung `mart.lieferkondition_beobachtet`: der Tourenplan lässt sich aus dem
Warenkorb nicht lesen, nur der Spielraum. Einschränkung: ein einziger Warenkorb, ein einziger Lieferant, ein
geschlossener Betrieb (dessen Konditionen können abgelaufen sein).

### Offen bleibt in Messung 1

* **Mindestbestellwert und Bestellfrist bei anderen Lieferanten** (Distra: 0 und keine). Der Pfad ist gesperrt; ohne
  schreibenden Seiteneffekt gibt es keinen lesenden Zugang. Optionen: ein Warenkorb, den ohnehin jemand bearbeitet
  (dort ist die Änderung belanglos — nur mit ausdrücklichem Ja des Nutzers), oder die Frage an Lieferant/FoodNotify.
* Ob der Server den Termin nur verschiebt, wenn er **abgelaufen** ist (hier vermutlich: gespeichert war März),
  oder bei jedem Lesen neu setzt — ungemessen.
* `preorderDays` bei einem Lieferanten mit Vorlauf — ungemessen.

## Messung 2 — Verkäufe als Quelle

Kostenstellen (mit Namen): **7984** Wilma Wunder Ballplatz Mainz — Bar Ballplatz, **9444** Wilma Wunder Ballplatz Mainz —
Küche Ballplatz, **10772** Wilma Wunder Karlsruhe — Bar Karlsruhe. Alle amadeus, alle echt.

### Parameter (aus dem Bundle gelesen, dann bestätigt)

`GET /api/{erpId}/sales?page&page_size&order_by&order_direction[&from&to&status]` — `order_by` ∈ `timeSold`, `sumPrice`,
`saleStatus` (Standard `timeCreated`), `order_direction` `ASC`/`DESC`. **`page_size=1000` hält** (gemeldet 1000, 413 KB,
0,8–0,9 s). `from`/`to` (Format ungemessen) und `status` wurden nicht benutzt. `recipe-sale` nimmt `page`/`page_size`;
**`page_size=100` hält** (`current_page_size` 100; ein Bon mit 62 Positionen in einem Aufruf — mit dem Standard 10
wären es sieben).

### Was ist ein Verkauf?

**Ein Kassenvorgang (Bon / Tischabrechnung).** Belege: (1) die **Summe der Positionen trifft `sumPrice` auf den Cent**
(6 von 6 Verkäufen, Abweichung 0,00); (2) 1 bis 63 Positionen je Verkauf; (3) Verkaufszeit auf die Sekunde
(`timeSold`), in Kassenzeiten (Ballplatz: 09–23 Uhr, kein Verkauf vor 08:00; Karlsruhe 1,6 % vor 08:00); (4) `sumPrice`
ist **netto** (0,6722689076 = 0,80 EUR brutto bei 19 %). Kein Tagesabschluss, kein Importpaket — `timeCreated` ist die
Anlagezeit in FoodNotify.

| | 7984 Bar Ballplatz | 9444 Küche Ballplatz | 10772 Bar Karlsruhe |
|---|---|---|---|
| Verkäufe insgesamt | 21.363 | 21.471 | 20.653 |
| ältester Verkauf (`timeSold`) | 15.09.2026 15:15 | 15.09.2026 11:31 | 12.08.2026 15:50 |
| … angelegt (`timeCreated`) | 20.09.2026 | 21.09.2026 | 12.08.2026 |
| jüngster Verkauf in den 1.000 Zeilen | 19.11.2026 09:29:46 | 19.11.2026 09:29:46 | 18.11.2026 22:31 |
| Status / Typ | 1.000 von 1.000 `finish` / `amadeus` | dito | dito |
| `finishError` gesetzt | 0 | 0 | 0 |
| Verzug `timeCreated` − `timeSold` | Median 12 min, p90 19, max 36 | 12 / 20 / 29 | 12 / 23 / 35 |
| Anlageschübe je Tag (verschiedene `timeCreated`) | Median 44 | 45 | 35 |
| negative `sumPrice` (von 1.000) | **273** | **271** | **0** |
| Nullsummen (von 1.000) | 20 | 21 | 52 |

* **Spanne:** FoodNotify hat die Verkäufe **ab der Anbindung** — 12.08.2026 (Karlsruhe, am selben Tag angelegt) und
  15.09.2026 (Ballplatz, am 20./21.09. nachträglich angelegt). Eine ältere Historie gibt es dort nicht. Nur ein Teil
  der Kostenstellen kann so weit zurück wie Ballplatz/Karlsruhe.
* **Anlage:** FoodNotify legt die Verkäufe laufend an, **alle ~20–30 Minuten** (35–45 Schübe je Tag), mit einem Verzug von
  12 Minuten (Median) bis 36 Minuten nach der Kasse. Der jüngste Verkauf war bei dem Abruf (10:10 Berliner Zeit)
  vom selben Morgen.
* **Negative Verkäufe sind Gegenbons.** Jeder der 273 (Bar) und 271 (Küche) negativen Verkäufe hat in derselben Seite einen
  positiven mit **demselben Betrag** (273 von 273, 271 von 271; Extremwerte ±345,44 und ±350,06). Karlsruhe hat keinen.
  Wer Verkäufe zählt oder Umsatz bildet, muss entscheiden, ob Stornobons zählen — 27 % der Zeilen am Ballplatz.
* **Bar und Küche des Ballplatzes tragen dieselben Bons.** Die 1.000 jüngsten Zeilen beider Kostenstellen beginnen und
  enden auf derselben Sekunde (14:45:19 und 09:29:46); von 999 Verkaufszeiten stimmen **998** überein, bei **933** auch
  die Summe. Beide Kostenstellen hängen an **einer** Kassenanbindung; jeder Bon wird in beide
  übernommen (verschiedene Verkaufs-IDs, gleicher Inhalt: die Kopfpositionen zweier Bons der gleichen Minute sind identisch,
  2 Positionen à 3,28 EUR). **Verkäufe oder Umsatz über Bar + Küche zu addieren verdoppelt.** Wie die Positionen auf Bar-
  und Küchenrezepte verteilt sind, ist nicht gemessen. Karlsruhe: die Küche (Kostenstelle 10773) wurde nicht gemessen.
* **Verkäufe je Tag, vollständige Tage** (netto, `sumPrice`, einschließlich der Gegenbons):

| Tag | 7984 Bar Ballplatz | 9444 Küche Ballplatz | 10772 Bar Karlsruhe |
|---|---|---|---|
| Sa 14.11. | — | — | 399 Verkäufe, 10.548 EUR |
| So 15.11. | (angeschnitten) | (angeschnitten) | 241, 6.052 EUR |
| Mo 16.11. | 272, 2.151 EUR | 272, 2.283 EUR | 106, 1.511 EUR |
| Di 17.11. | 243, 2.165 EUR | 243, 2.208 EUR | 33, 453 EUR |
| Mi 18.11. | 265, 2.331 EUR | 266, 2.415 EUR | 131, 2.250 EUR |

  **1.000 Zeilen decken nur 4 bis 5 Tage** (Ballplatz 15.11. 14:45 bis 19.11. 09:29, Karlsruhe 13.11. 19:48 bis 18.11.
  22:31): die letzten 14 Tage brauchen 4 Seiten zu 1.000 (Ballplatz) bzw. 2 (Karlsruhe). **Lücken in den Tagen:** keine zwischen den vollständigen. Die IDs haben große Lücken (206.885 im
  Fenster), weil der Nummernraum über alle Kostenstellen läuft.
* **Gegenprobe gegen LINA: nicht möglich.** Der lokale Bestand (`lina`, nur localhost) endet am 12.08.2026; FoodNotify
  hat bei Karlsruhe am 12.08. nur den Nachmittag, bei Ballplatz beginnt es später. Es gibt keinen Tag in beiden
  Quellen, der in FoodNotify vollständig ist und lokal in LINA steht. Größenordnung (ausdrücklich **kein Abgleich**,
  Sommer gegen November, Betrieb gegen Kostenstelle): LINA-Betrieb Karlsruhe Juni–August 2026 Mittelwert Samstag
  11.683 EUR, Sonntag 7.923, Mittwoch 5.105, Montag 4.630, Dienstag 4.339 — FoodNotify Bar Karlsruhe Samstag 10.548 und
  Sonntag 6.052, aber Mittwoch 2.250, Montag 1.511 und **Dienstag 453 EUR bei 33 Verkäufen**. Der Dienstag ist
  auffällig (Ruhetag? fehlende Bons?) und nicht erklärt. **Offen:** den Tagesabgleich 14.–18.11.2026 gegen die
  Produktivdaten (Umsatz je Betrieb und Tag) ziehen; die Tageszahlen oben sind dafür vollständig.

### Die Position (`recipe-sale`)

* **Felder der Position:** `id`, `amount`, `price`, `sumPrice`, `voidReason`, `recipe{id, name, price,
  recipeIngredients[]}`, `recipeUrl` — dazu zwei Felder zur bedienenden Person, die hier nicht ausgewertet werden.
  `sumPrice` der Positionen = `sumPrice` des Verkaufs (Abweichung 0,00 bei 6 von 6).
* **Keine Kassen-PLU, keine Artikelnummer.** Gesucht über alle Feldnamen von Position, Rezept und Zutat
  (`plu`, `artikel`, `article`, `nummer`, `number`, `ean`, `sku`): **keine Treffer.** Die Position trägt nur die
  **Rezept-ID** (`recipe.id`). Die Brücke Kassenartikel → Rezept (`core.pos_artikel`, `0155`) bleibt damit nötig: aus dem
  Verkauf allein ergibt sich die PLU nicht, aus der PLU über `pos_artikel` das Rezept.
* **Rezeptnamen:** 1 von 2, 7 von 62, 8 von 63, 3 von 30 und 0 von 23 Positionen enden auf „(Kasse)" — FoodNotify legt
  Kassenartikel ohne eigenes Rezept als „…(Kasse)"-Rezept an. `recipe.price` ist 0.
* **`recipeIngredients` (Zutaten je Position):** `id`, `isRecipe` (bei allen 3 gelesenen Verkäufen je Position true:
  aufgelöst), `name`, `unitName` (`g`, `ml` oder `cu_<Nr>` = eigene Stückeinheit, deren Text in `customUnitName`
  steht, etwa „Stück (4 g)"), **`unitQuantity` = Menge je verkaufter Einheit** (24 g Bohnen je Cappuccino), `deleted`
  und `unresolvable` (überall false). **Keine Artikelnummer, keine Lieferanten-Nr., keine Kosten.** Zutaten je Position:
  min 1, Median 1 bis 6, max 11 bis 13. Dass `id` gelegentlich gleich `recipe.id` ist (Halbfabrikate „BA_…"), deutet darauf, dass die
  Zutat-ID eine **Rezept-/Zutat-ID** von FoodNotify ist, nicht die Lieferanten-Artikelnummer. Ob sie auf
  `core.rezept`/`core.ware` abbildbar ist, ist **ungemessen** (lokal noch kein `0132`).
* **Größe und Dauer:** 1,2 KB bei 2 Positionen, 65 KB bei 62, 27 KB bei 23–30 (rund 1 KB je Position); 170–450 ms.

### Kostenrechnung (aus den Messwerten, alles Hochrechnung)

| | Ballplatz (7984/9444) | Karlsruhe (10772) |
|---|---|---|
| Verkäufe je Tag (Median der vollständigen Tage) | 265 | 131 (Samstag 399) |
| **Tagesimport je Kostenstelle:** 1 Listenaufruf + 1 Positionsaufruf je Verkauf | **266** | **132** |
| Tagesimport bei 35 Kostenstellen, wenn alle so wären | 9.310 | 4.620 |
| … bei Takt 200–500 ms (Mitte 0,35 s) | ~0,9 h | ~0,45 h |
| Historie bis heute (Gesamtzahl): Listenseiten + Positionsaufrufe | 22 + 21.363 = **21.385** | 21 + 20.653 = **20.674** |

* **Fast alles sind Positionsaufrufe.** Es gibt keinen Weg, den Soll-Verbrauch **ohne** `recipe-sale` aus der Liste zu
  bilden: die Liste führt nur `id`, `sumPrice`, `saleStatus`, `saleType`, `finishError`, `timeCreated`, `timeUpdated`,
  `timeSold`. Menge und Rezept stehen nur in den Positionen.
* **12 Monate zurück ist unmöglich**, die Historie beginnt mit der Anbindung (siehe oben): das ist der
  Gesamtbestand, **rund 21.000 Verkäufe je Kostenstelle**. Für 31 echte Kostenstellen bis zu **~650.000 Aufrufe** — fünf
  Nächte unter dem **ganzen** `FN_TAGESBUDGET` (140.000), wenn sonst nichts läuft. Nicht alle 31 verkaufen so viel: Küchen mit
  25 Bestellungen im Klon sind vermutlich ohne Verkaufsimport; gemessen sind drei.
* **Der Tagesimport allein ist bezahlbar** (4.600–9.300 Aufrufe/Tag bei Budget 140.000, einige Prozent). Der Preis ist
  nicht das Tempo, sondern der **Einzelabruf je Bon**.
* **Nicht gemessen, aber im Bundle:** `GET /api/{erpId}/recipe-sale/paginate` mit `page_size, page, order_by, order_direction,
  from, to` (Panel; „ob die Oberfläche diesen Pfad nutzt, ist nicht belegt") und
  `GET /api/pos/mapping/{accountId}/article-sales` (Brew). Beide könnten Positionen **tageweise statt je Bon** liefern
  (ein Aufruf je 100–1.000 Positionen statt je Verkauf) — dann sänke der Tagesimport von ~266 auf einige Aufrufe. **Das
  ist die nächste Messung**, bevor ein Import gebaut wird.

### Empfehlung

* **Verkäufe als Soll-Verbrauch importieren: nicht in der gemessenen Form.** Die Form „Liste + ein Positionsaufruf je Bon"
  ist machbar (4.600–9.300 Aufrufe/Tag), aber teuer, und sie lädt Doppelungen (Bar + Küche), Gegenbons und keine PLU mit.
* **Zuerst die Aggregat-Pfade messen** (`recipe-sale/paginate` mit `from`/`to`, `pos/mapping/{id}/article-sales`; je
  höchstens zwei Aufrufe an 7984, in die Erlaubtliste mit eigenem Test), und den **Tagesabgleich gegen den
  LINA-Umsatz** (14.–18.11.) ziehen. Erst dann entscheiden.
* **Wenn importiert wird:** nur das Tagesgeschäft (neueste zuerst, `page_size=1000` absteigend nach `timeSold`, bis zum
  letzten bekannten Verkauf), Positionen mit `page_size=100`; die Historie nur so weit, wie sie in FoodNotify liegt;
  Bons je **Anbindung** einmal, nicht je Kostenstelle; Gegenbons als eigenes Kennzeichen; Bedeutung der Zutat-ID vorher klären.

## Was offen bleibt

* Mindestbestellwert und Bestellfrist bei anderen Lieferanten (Pfad gesperrt).
* Tagesabgleich Verkäufe gegen LINA (14.–18.11.2026) — mit Produktivdaten.
* Aggregat-Pfade für Positionen (`recipe-sale/paginate`, `article-sales`) ungemessen.
* Bedeutung von `recipeIngredients[].id` (Rezept-ID?) und die Verteilung der Positionen auf Bar und Küche.
* Der Dienstag in Karlsruhe (33 Verkäufe).
* Die anderen Marken und Kostenstellen; die Küche in Karlsruhe.

Nachgemessen am 19.11.2026, 09:09–09:11 UTC.
