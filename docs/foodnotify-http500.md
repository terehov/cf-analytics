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
