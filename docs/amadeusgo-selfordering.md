# amadeusGO und der Haken „Aktiv in Self-Ordering“

Erhoben am 13.11.2026 aus Anlass einer Anfrage von Laura Scherer (Operations Wilma Wunder):
Die digitalen Karten der Wilma-Betriebe sollen bei jeder Kartenänderung gegen die gedruckte
Karte geprüft werden. Die Betriebe pflegen die digitale Karte selbst, indem sie jeden Artikel
in LINA anhaken („Webshop / Selfordering / Lieferdienste → Aktiv in Self-Ordering“).

**Entscheidung Eugene, 13.11.2026: Das wird NICHT importiert.** Keine Tabelle, kein Nachlauf,
kein Abruf im Sync. Die Prüfung macht Laura selbst mit Claude im Browser (Claude in Chrome).
Diese Datei hält nur fest, was gemessen wurde, damit es niemand ein zweites Mal herausfinden muss.

## Was amadeusGO ist

amadeusGO ist **LINAs eigenes Self-Ordering**. Das Frontend-Bundle enthält
`selfordering_lina_pay_enabled` und `selfordering_lina_pay_description`, und im Umsatzbericht
ist `AmadeusGO` die Verkaufsstelle 2 (`getUmsatzbericht:vs_amadeusgo`, `0112`). Die digitale
Karte zeigt genau die Artikel, die im Artikelstamm des Betriebs angehakt sind. **Die Karte zu
prüfen heißt also, den Haken zu prüfen.**

## Die öffentlichen Karten (nachgemessen 13.11.2026)

`https://www.wilma-wunder.de/restaurants/<stadt>/karte/` leitet mit HTTP 200 auf amadeusGO
weiter. Es gibt zwei Oberflächen:

| Oberfläche | Adresse | Inhalt |
|---|---|---|
| alt | `amadeusgo.de/selfordering/index/<store>/?table=…` | Karte steht im HTML (Mainz Ballplatz: 468 KB) |
| neu | `amadeusgo.de/shopsystems/selfordering/menu?store=<store>&table=…` | leere Hülle, Daten per JSON |

Beide liefern die Daten auch als JSON, ohne Anmeldung:

1. `GET /api/getUserSession?store=<store>&table=<table>&legacy=false&&system=selfordering` → `sessionHash`
2. `GET /api/getArticles?store=<store>&table=<table>&legacy=false&session=<sessionHash>`
   → `[{shopId, meccodes:[{name, meccodeGroup, articles:[{id, name, name5, descr5, price, function, tags, image, allergenes, …}]}]}]`

`articles[].id` ist die **betriebslokale LINA-Artikel-id** (Bochum: 2091, 3070 …), nicht die
Artikelnummer. Stand 13.11.2026, Hauptartikel (`function = MAIN`) je Karte:

| Betrieb | store | Artikel | Betrieb | store | Artikel |
|---|---|---|---|---|---|
| Bochum | W54Mzr | 168 | Nürnberg | yoYxJL | 182 |
| Dresden | 94X9rn | 161 | Passau | Ay7yoX | 195 |
| Düsseldorf | PEX3Eb | 146 | Speyer | xwD9aX | 189 |
| Freudenstadt | 9APmj4 | 182 | Stuttgart | PY4xwd | 160 |
| Karlsruhe | XvmPW0 | 192 | Viernheim | 30nLK4 | 168 |
| Köln | O4jO7L | 196 | Recklinghausen | dpjlry | 139 |
| Mainz am Markt | OQ4Rj | 176 | Mainz Ballplatz | zJL5ld | 178 |

Nebenbefunde vom selben Tag:
- **Recklinghausen ist geschlossen, die Karte ist noch online** (139 Artikel, bestellbar
  erscheinend). Laura führt den Betrieb nicht mehr in ihrer Liste.
- **Düsseldorf** hat inzwischen eine amadeusGO-Karte. Claudes Prüfung vom 17.10.2026 fand dort
  nur PDF-Links auf die Sommerkarte.
- „Wilmas Herbstwunder“ steht noch in Bochum, Köln, Mainz am Markt, Speyer und Viernheim.

## Warum Claude im Chat die Karten nicht lesen konnte

Die Excel vom 17.10.2026 (aus Daniels Claude-Sitzung) prüfte 5 von 14 Betrieben, der Rest sei
„blockiert“ oder „leer“. Beides lag am Abrufwerkzeug, nicht an amadeusGO. Die Seiten antworten
jedem Browser und jedem `curl` mit 200. Vermutlich folgt das Werkzeug keiner Weiterleitung auf
eine andere Domain und führt kein JavaScript aus (die neue Oberfläche ist ohne JS leer). Nicht
nachprüfbar, aber mit dem Befund verträglich. Claude in Chrome hat beide Einschränkungen nicht.

## Die Excel verglich gegen die falsche Karte

Die Excel prüfte alle Betriebe gegen die **Karlsruher** Druckkarte (W5). Jeder Betrieb hat
eigene Preise und regionale Artikel. Gegen die Druckkarte **Mainz Ballplatz** (W7, von Laura am
13.11.2026 geschickt) stimmen in der digitalen Karte Mainz Ballplatz **27 von 27** geprüften
Preisen; gegen Karlsruhe wären es 0. Die 110 „Preis abw.“ der Excel für Mainz Ballplatz sind
fast alle ein Vergleich gegen die falsche Karte. **Eine Prüfung braucht die Soll-Karte des
jeweiligen Betriebs.**

Offen und nicht weiter verfolgt: Karlsruhes digitale Preise lagen am 13.11.2026 deutlich unter
denen vom 17.10.2026 (Pflanzengourmet 11,80 statt 14,40). Ob das eine Aktion, eine andere
Preisebene der Self-Ordering-Tische oder eine echte Preisänderung ist, ist nicht gemessen.

## Der Haken in LINA

`/wawi/rezept/articleApi` führt je Artikel `selfordering` (0/1) und `shop_ids`
(`lina-api-korrekturen.md`, „Neu: Rezepturen“). Der Sync holt den Endpunkt monatlich als
`articleApi:franchise` — das sind die **Zentralartikel**: im Abzug vom 02.08.2026 9.144 Artikel,
223 mit `selfordering = 1`, `shop_ids` überall leer. **Daraus ist der Haken je Betrieb nicht
ablesbar.**

~~Ob `articleApi` mit `storeId` den Artikelstamm eines Betriebs liefert, misst
`bun run lina-fragen d11` (zwei GET, nur im Terminal des Nutzers — Regel 7a). Noch nicht gelaufen.~~

**Nachgemessen am 13.11.2026 (`lina-fragen d11`, Terminal Eugene): `storeId` wird ignoriert.**

| Aufruf | Artikel | `selfordering = 1` | mit `shop_ids` | Bytes |
|---|---|---|---|---|
| `articleApi` ohne Parameter | 1.428 | 3 (0,5l Helles, Stück Kuchen, Triple Sweets) | 18 | 447.136 |
| `articleApi?storeId=<Wilma Ballplatz Mainz>` | 1.428 | 3 | 18 | 447.136 |

Gleiche ids in beiden Listen: 1.428 von 1.428. Geliefert wird der Stamm des Betriebs, auf
dem der Zugang sitzt (System `a360`), nicht der adressierte. amadeusGO zeigte für Mainz
Ballplatz am selben Tag 178 Hauptartikel. **Der Haken je Betrieb ist über den Scraper-Zugang
nicht lesbar.** Die öffentliche Karte bleibt die einzige Quelle: Was dort steht, ist angehakt.
Kein weiterer Versuch über diesen Endpunkt. Anders als die Report-Endpunkte
(`lina-api-korrekturen.md`) wertet `articleApi` den Parameter `storeId` nicht aus.

Der TPAPI-Artikelstamm (`merchandiseman/recipe`, je Betrieb) hat auf oberster Ebene **kein**
Self-Ordering-Feld (Formprobe 12.11.2026: `id, number, name, active, function, detailcategory,
meccode, …, prices, attributes`). Ob es in `prices[]` (dort steht ein `menucard…`-Feld) steckt,
ist nicht geprüft.
