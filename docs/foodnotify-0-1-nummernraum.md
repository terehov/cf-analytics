# 0.1 — Die Brücke Artikel ↔ Rezept

Stand 01.08.2026. Gehört zu `docs/plan-foodnotify.md`, Stufe 0.1.
Geprüft an der Marke **Aposto** (`Admin.foodnotify@aposto.eu`), rein lesend.

## Ergebnis

**Die Brücke ist da — aber über `plu`, nicht über `zutat.artikelId`.**

```text
core.artikel.artikelnummer  ==  pos/mapping/{connectionId}/articles → items[].plu
                                                                   → items[].recipeId
                                                                   → core.rezept
```

Damit ist Weg 1 aus §3.3 erledigt: das POS-Mapping ist auslesbar, ohne
Support-Anfrage. Die Account-ID, die im Inventar als unauffindbar galt, ist
die **`connectionId`** aus `/api/pos/locations`.

## Der Beweis

Kostenstelle „Küche Aposto Gera", 1.283 POS-Artikel:

| | |
| --- | --- |
| `plu` trifft eine `artikelnummer` | 1.227 von 1.283 = **95,6 %** |
| davon mit echtem Namen auf LINA-Seite | 1.222 |
| **Name identisch** | **1.218 = 99,7 %** |
| Gegentest: Zufallszahlen gleicher Spanne | **0,3 %** |

99,7 % gegen eine Zufallserwartung von 0,3 %. Das ist kein Namensmatching,
sondern dieselbe Nummer für dieselbe Sache.

Die 146 Artikel, die dort bereits einem Rezept zugeordnet sind, treffen zu
**146 von 146**, davon 145 namensgleich — und tragen bei uns 1,19 Mio.
Verkaufszeilen.

Die Bar derselben Kostenstelle (connection 1905) bestätigt es unabhängig:
1.283 Artikel, 95,6 % Treffer, 1.218 von 1.222 namensgleich, Gegentest 0,2 %.

**Und die Zahl, die den Nutzen bemisst:** Von 3,54 Mio. € Umsatz, die wir für
Gera in `core.artikelverkauf_tag` führen, entfallen **1,77 Mio. € auf bereits
zugeordnete Artikel — 49,8 %.** Das deckt sich mit den 49 % zugeordnetem
Umsatz, die das Inventar für Aposto aus FoodNotifys eigener Kostenanalyse
gemessen hat. Zwei unabhängige Wege, dieselbe Zahl: die Zuordnung ist echt.

## Der Weg dorthin

1. `/api/pos/locations` → je Kostenstelle `restaurantId`, `costCenterId` und,
   wo eine Kasse angebunden ist, `connection.connectionId`.
2. `/api/pos/mapping/{connectionId}/articles` → `plu`, `name`, `recipeId`,
   `recipeTitle`, `price`, `vat`, `isIgnored`.
3. `/api/pos/mapping/{connectionId}/link-targets` → alle Rezepte als
   Zuordnungsziele (`recipeId`, `title`, `ingredientCount`).

**Der Parameter ist die `connectionId`, nicht die erpId, nicht die
Kostenstelle, nicht das Restaurant.** Deshalb waren die Versuche im Inventar
alle 404: die durchprobierten IDs waren aus den falschen Namensräumen.

## Warum es vorher aussichtslos aussah

Der Menüpunkt fehlt in der Oberfläche dieses Kontos, und der direkte Aufruf
von `/brew/settings/pos/2051/mapping` liefert **403 — auch für die Oberfläche
selbst**. Die Seite lädt, zeigt „POS-Artikel konnten nicht geladen werden"
und meldet 0 Artikel.

`2051` ist eine andere Ebene als die `connectionId`. Über die
`connectionId` sind dieselben Endpunkte **ohne Einschränkung** lesbar (HTTP
200, 268 kB). Die Berechtigung fehlt also nicht generell, sondern nur für
jenen Einstieg.

## Was `zutat.artikelId` stattdessen ist

Die ursprünglich geplante Prüfung ist damit beantwortet, aber negativ:
`artikelId` in den Rezeptzutaten ist eine **Lieferanten-Artikelnummer für
Rohware** („Zwiebeln Rot Sack 10Kg", „Auberginen Kg"), dieselbe Art Schlüssel
wie `shopArticleId` in den Inventurpositionen. Sie zeigt auf `core.ware`,
nicht auf `core.artikel`.

Stichprobe 30 Rezepte / 47 numerische `artikelId`: 4 Treffer (8,5 %), alle
auf Artikel ohne Namen, also keiner bestätigbar. Gegentest mit Zufallszahlen:
0 Treffer. Die 8,5 % kommen daher, dass beide Systeme kleine Nummern vergeben.

**Beide Aussagen gelten nebeneinander:** `artikelId` → `core.ware`,
`plu` → `core.artikel`. Der Plan hat die Kette an der richtigen Stelle
vermutet, nur am falschen Feld.

## Die Einschränkung, die bleibt

**Nur 4 von 27 Aposto-Kostenstellen haben überhaupt eine Kassenanbindung:**

| connectionId | Kostenstelle | Kassensystem |
| --- | --- | --- |
| 1907 | Küche Aposto Gera | `amadeus` |
| 1905 | Bar Aposto Gera | `amadeus` |
| 1657 | Küche Aposto Wuppertal | `ikentoo` |
| 1656 | Bar Aposto Wuppertal | `ikentoo` |

Und die Brücke trägt **nur bei `amadeus`** — das ist derselbe Datenstrom, den
wir aus LINA kennen. Bei Wuppertal (`ikentoo`) sind die PLUs klein und
fortlaufend (8–580); der Gegentest liefert dort 67 % Zufallstreffer, die
Prüfung ist wertlos. Das ist ein anderes Kassensystem mit eigenem
Nummernkreis.

Von 1.283 POS-Artikeln in Gera sind zudem erst **146 einem Rezept
zugeordnet** (11 %). Die Zuordnung existiert und ist auslesbar — sie ist nur
kaum gepflegt. Das deckt sich mit dem Befund aus dem Inventar, dass nur 49 %
des Aposto-Umsatzes zugeordnet sind.

`deviceType.matchingStrategy` steht auf `plu` und `providesSkus` auf `true` —
FoodNotify selbst ordnet also über die PLU zu. Genau deshalb funktioniert der
Abgleich.

## Was daraus folgt

* **Stufe 2.3 ist gelöst**, technisch. Der Join ist
  `core.artikel.artikelnummer = plu`, die Rezeptzuordnung kommt aus
  `recipeId`.
* **Das Support-Ticket (0.2) bleibt nötig**, aber mit anderen Punkten: der
  Verkaufsfehler aus §8a und der lesende Subuser. Die POS-Frage ist erledigt.
* **Neu für den Importer:** `/api/pos/locations` je Marke abfragen, die
  `connectionId` je Kostenstelle merken, `deviceType.name` mitführen — die
  Brücke gilt nur für `amadeus`.
* **Offen:** ob bei den anderen drei Marken mehr Kostenstellen angebunden
  sind. Ein Aufruf je Marke klärt das.

## Nebenbefunde

* **672 Rezepte bei Aposto** (Enchilada 1.846) — Rezepturen werden je Marke
  getrennt gepflegt. Klärt offenen Punkt 4 des Inventars.
* `kind` in den Zutaten hat die Werte `ingredient` und `sub_recipe`; 20 von 92
  Zutaten sind Unterrezepte ohne `artikelId`. Die rekursive Auflösung aus A3
  ist bestätigt nötig.
* `runner-bummer/ingredients` liefert bei Aposto **echte Zahlen**.
* `core.artikel`: 21.287 Artikel, alle mit Verkäufen; 13.727 tragen nur einen
  Platzhalternamen (`Artikel 12345`) — der Name fehlt, der Artikel ist echt.
* `fixer_we` ist bei 20.808 von 21.287 null, belegt nur bei 479 (2,2 %).
  `mart.pruefung_wareneinsatz` rechnet auf gut zwei Prozent der Artikel — ein
  Argument für die Stilllegung in 0.3, unabhängig von der Herkunftsfrage.
