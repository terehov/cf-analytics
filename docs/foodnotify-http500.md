# HTTP 500 bei `/shop-order/{id}/change` — Meldung an FoodNotify

> **Nachtrag 01.09.2026 — die Kernaussage ist überholt.** Die Wiederbelebung
> (`aufgegebeneWiederbeleben()`, Migration 0070) hat **282 der 292** hier
> gemeldeten Bestellungen nachträglich doch geholt: in `sync.warteschlange`
> stehen 282 Posten `fn:bestellpositionen` mit `ergebnis = 'ok'` und
> `wiederbelebt = 1`. „Deterministisch und dauerhaft" war also nur
> „deterministisch am Messtag" — auf FoodNotify-Seite hat sich etwas bewegt.
> **10 Bestellungen fehlen weiterhin** (alle Enchilada, Juli/August 2026);
> sie laufen über `mart.posten_aufgegeben` aus.
>
> Der Rest des Dokuments bleibt als Messprotokoll vom 04.08.2026 stehen —
> als Meldung an FoodNotify ist er nicht mehr zu verwenden.
>
> Und eine Lehre daraus steht im Fehlerkatalog: exakt diese zehn Posten
> haben in den Läufen 108–110 drei Nächte in Folge die FoodNotify-Spur
> abgebrochen, weil zehn wiederbelebte Fehler in Folge die Notbremse
> `ABBRUCH_NACH_FEHLERN` trafen. Seit dem 01.09.2026 zählen
> Wiederholungsfehler nicht mehr als „Fehler in Folge", und ein Lauf
> weckt höchstens `WIEDERBELEBUNGEN_JE_LAUF` Posten.
>
> **Nachtrag 10.09.2026.** Die 282 kamen nicht, weil sich bei FoodNotify etwas
> bewegte, sondern weil unser Zeitplan sie erst dann wieder fragte: alle am Tag
> 9–11 nach dem ersten Fehler, nach drei Fehlnächten, Aufgeben und einer Woche
> bis zur Wiederbelebung. Seitdem bekommt ein 500 auf dieser Ressource eine
> Wiedervorlage je Nacht, `FN_POSITIONEN_MAX_NAECHTE = 10` Nächte lang
> (`entscheidungen.md`, E3 vom 10.09.2026).

> **Nachtrag 19.10.2026, abends — der Ersatzweg ist gebaut (Migration `0135`).** Melden geht nicht:
> FoodNotify wüsste dann, dass wir die interne Schnittstelle nutzen (Eugene). Deshalb liest der Importer
> für Bestellungen, deren `/change` mit HTTP 500 scheitert, die Bestellansicht der Oberfläche
> (`/shop/{shopId}/orders/{ansicht_nr}`, Endpunkt `fn:bestellansicht`). Gemessen an Bestellung 450:
> Artikelnummer, Menge, Gebinde und Summe in **53 von 53** Positionen gleich wie `/change`; es fehlen
> nur Inhalt je Gebindestück und Basiseinheit — die übernimmt der Lader aus der jüngsten
> Schnittstellen-Position derselben Marke, Artikelnummer und Gebindegröße. Aufbau, Sperren und
> Prüfsicht: `importer.md` und `datenmodell.md`, Abschnitt 0135. Ob er trägt:
> `SELECT * FROM mart.bestellansicht_stand` — Erwartung `ohne_positionen = 0` nach zwei Nächten
> (die erste holt die Bestellköpfe neu, die vor 0135 keine Ansichtsnummer trugen).
> Mit dem Importer-Zugang (nicht nur dem Admin-Zugang) nachgemessen am 19.10.2026: 44 von 44 Zeilen
> (`bun run bestellansicht-probe`, Exit 0).
>
> **Nachtrag 19.10.2026 — die Ursache ist gefunden: ein Artikel, „Pickled Onions Gelb 3Kg Eimer“.**
> Im Browser mit Eugenes Enchilada-Zugang nachgesehen, nur lesend:
>
> * Unser `orderId` ist die ID des Bestellvorgangs, die Oberfläche zeigt die Nummer der
>   Lieferantenbestellung (`markedShopOrder.orderId`). Bestellnummer 451 ist bei uns 638090,
>   in der Oberfläche 645599. Unter dieser Nummer öffnet sich die Bestellung **vollständig**,
>   mit 44 Artikeln und 1.587,37 €.
> * Derselbe Abruf, den der Importer macht (`/api/10262/shop-order/638090/change`), scheitert
>   auch in der Browser-Sitzung, mit Fehlertext:
>   `{"statusCode":500,"title":"NonUniqueResultException","message":"More than one result was
>   found for query although one row or none was expected."}` — FoodNotify findet zu einem
>   Datensatz zwei Treffer, wo einer erwartet ist. Ein Datenfehler bei FoodNotify, nicht bei uns.
> * Die 17 DISTRA-Bestellungen der Bar auf der ersten Listenseite (447–463) einzeln geprüft:
>   14 antworten mit 500, 3 mit 200 (449, 450, 462). **Genau ein Artikel steckt in allen 14
>   kaputten und in keiner der 3 guten: `productId` 27826673 = Pickled Onions Gelb 3Kg Eimer,
>   DISTRA-Artikelnummer 500081, 15,51 €.** Vermutlich ist er in der Kostenstelle 10262 doppelt
>   zugeordnet; andere Betriebe bestellen dieselbe Nummer ohne Fehler.
> * Auch 447 und 448 scheitern inzwischen. Ihre Positionen haben wir aus dem ersten Abruf; jeder
>   spätere Nachabruf läuft auf den Fehler. Das bestätigt die Lesart vom 15.10.: der Artikel
>   macht jede Bestellung kaputt, in der er steht, auch rückwirkend.
>
> **Nachgesehen in der Bar selbst (19.10.2026, Kostenstelle in der Oberfläche auf „Bar Enchilada
> Augsburg“, nur lesend):**
>
> * Der Marktartikel ist sauber: ein Eintrag, ein Gebinde (`/api/shop/products/27826673/packagings`
>   → `EI`, 1), Artikelseite ohne Auffälligkeit.
> * In keiner Bestellung steht er doppelt: in jeder der 14 kaputten genau einmal.
> * Im Warenstamm der Kostenstelle (`/api/10262/products`) stehen nur 8 Artikel, Pickled Onions ist
>   nicht dabei. In „Meine Produkte“ (`/shop/6421/favorites`) auch nicht.
> * **Die Listen-Seite der Bar (`/shop/6421/lists`) bricht selbst mit HTTP 500 ab.** Die Artikelseite
>   bietet „Favoriten – Listenprodukt“ (`/shop/6421/lists/27826673/toggle`) an, und die Artikel im
>   Warenstamm tragen ein Feld `isInProductLists`. Naheliegend ist deshalb: der Artikel hängt in den
>   Produktlisten der Bar doppelt, und sowohl die Listen-Seite als auch der Positionsabruf laufen auf
>   denselben doppelten Eintrag. **Nicht bewiesen** — die Listen-Seite liefert nur „Internal Server
>   Error“ ohne Grund, und der Vergleich mit einer anderen Bar hätte einen Wechsel der Kostenstelle
>   verlangt (der Wechsel läuft über `/shop/6421/cart/update/restaurant/…` und schreibt in einen
>   Warenkorb).
> * Zeitpunkt: 447 und 448 (Juli/August) liefen beim ersten Abruf durch und scheitern seit dem
>   Nachabruf Anfang September (aufgegeben am 06.09.). Die Dopplung ist also um den 31.08. entstanden,
>   nicht mit dem Artikel.
>
> Weil die Listen-Seite selbst abstürzt, lässt sich der doppelte Eintrag in der Oberfläche
> vermutlich nicht entfernen — das braucht den FoodNotify-Support.
>
> Abhilfe kann nur bei FoodNotify oder in der Artikelzuordnung der Bar liegen. Danach holt der
> Importer die Positionen von selbst nach (Wiederbelebung, Fingerabdruck). Offen in `offene-punkte.md`.

> **Nachtrag 15.10.2026 — seit dem 31.08. ist es eine Kostenstelle, nicht einzelne Bestellungen.**
> Gemessen über MCP auf `mart.einkauf_beleg` (Bestellungen 15.08.–10.10.2026, nicht storniert,
> `positionen = 0`): **genau eine** Kombination im ganzen Konzern ist betroffen — Enchilada Augsburg,
> Bereich Bar, DISTRA Enchilada_Coyacan (erpId `10262`). Dort kamen die Bestellungen 434–450
> (01.07.–25.08.) mit 37–66 Positionen, ab 451 (31.08.) **zwölf von dreizehn ohne eine einzige**
> (451–461 und 463). Nur 462 vom 12.10. lief durch (47 Positionen). Jede andere Kostenstelle,
> auch Küche und die übrigen Lieferanten derselben Bar, lädt normal.
>
> Die Wiederholungen helfen hier nicht: Bestellung 451 steht nach sechs Wochen weiter ohne Positionen,
> anders als 2026-08, wo die Fehler nach 9–11 Tagen verschwanden.
>
> **`mart.posten_aufgegeben` zählt zu viel.** Zehn der fünfzehn aufgegebenen Posten (orderId
> 612264 … 630950) gehören zu den Bestellungen 439–448. Deren Positionen sind **vorhanden**, aus
> einem früheren, erfolgreichen Abruf. Gescheitert ist ein späterer Abruf derselben Bestellung,
> aufgegeben am 06.09. Das passt zur Lesart „die Kostenstelle antwortet seit Ende August mit 500,
> egal welche Bestellung“. Nicht nachgemessen: `sync.warteschlange` und `raw.api_antwort` sind über
> MCP nicht lesbar, deshalb ist ungeprüft, ob diese zehn tatsächlich Nachabrufe waren. Offen in
> `offene-punkte.md`.

**Stand 04.08.2026.** Daten: `docs/foodnotify-http500.csv` (282 Zeilen, eine je betroffener
Bestellung).

## Was passiert

Der Abruf der Bestellpositionen

```
GET /api/{erpId}/shop-order/{orderId}/change?order_by=name
```

antwortet für **282 bestimmte Bestellungen** mit **HTTP 500**. Alle anderen Bestellungen
derselben Kostenstellen, derselben Zugänge und desselben Zeitraums werden fehlerfrei
geliefert.

## Warum es kein Last- oder Zugangsproblem ist

Nachgemessen an 4.092 Abrufen desselben Endpunkts innerhalb von sechs Stunden:

| | |
|---|---|
| Bestellungen, die nach einem 500 bei einem Wiederholungsversuch doch noch geliefert wurden | **0** |
| Bestellungen, die bei **allen** Versuchen 500 lieferten | **282** |
| Bestellungen ohne einen einzigen 500 | 3.821 |

Der Fehler ist damit **deterministisch und an die einzelne Bestellung gebunden**, nicht an
Zeitpunkt, Tempo, Kostenstelle oder Zugang. Jede der 282 Bestellungen wurde drei- bis
viermal abgerufen, jeweils mit demselben Ergebnis.

Ergänzend:

* Kein einziger **HTTP 429** über den gesamten Zeitraum — es liegt keine Drosselung vor.
* Die Anmeldung ist gültig; unmittelbar vor und nach jedem 500 liefert derselbe Zugang
  andere Bestellungen mit 200.
* Der Fehlerkörper enthält keine verwertbare Meldung.

## Verteilung

| Marke (Mandant) | betroffene Bestellungen |
|---|---|
| Enchilada | 271 |
| Wilma Wunder | 8 |
| Aposto | 3 |

| Bestelljahr | betroffene Bestellungen |
|---|---|
| 2022 | 5 |
| 2023 | 82 |
| 2024 | 36 |
| 2025 | 88 |
| 2026 | 71 |

Der Schwerpunkt liegt klar beim Enchilada-Mandanten, verteilt über alle Jahre — es sieht
nicht nach einem einzelnen Migrationsfehler eines Stichtags aus.

## Was in der CSV steht

| Spalte | Inhalt |
|---|---|
| `Marke` | Mandant / Zugang |
| `Kostenstelle` | Name laut `/api/erp/all` |
| `erpId`, `orderId` | die beiden Pfadsegmente des fehlschlagenden Aufrufs |
| `Bestellnummer`, `Bestelldatum` | aus der Bestellliste (`paginate`), die fehlerfrei lädt |
| `Versuche` | wie oft wir es probiert haben (alle mit 500) |
| `Erster/Letzter Fehler` | UTC-Zeitstempel, für den Abgleich mit euren Logs |
| `Angefragter Pfad` | der vollständige Pfad, unverändert reproduzierbar |

## Unsere Bitte

1. Prüfen, was diese 282 Bestellungen von den übrigen unterscheidet — die Bestellköpfe
   selbst sind über `paginate` und `/{orderId}` fehlerfrei abrufbar, nur `/change`
   scheitert.
2. Rückmeldung, ob die Positionen zu diesen Bestellungen bei euch vorhanden sind. Falls
   nicht, ist es kein API-Fehler, sondern eine Datenlücke — dann ist unsere Seite in
   Ordnung und wir hören auf, es zu wiederholen.

## Auswirkung bei uns

Zu diesen Bestellungen fehlen sämtliche Positionen. Kopf, Lieferant, Datum und Summe sind
vorhanden, die Warenzeilen nicht — betroffen sind rund **1 % aller Bestellungen**. Für
Auswertungen zu Einkaufspreisen je Ware fehlen diese Belege vollständig.
