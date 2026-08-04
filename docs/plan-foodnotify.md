# Plan: FoodNotify importieren und mit LINA verzahnen

Stand 27.07.2026, überarbeitet am 01.08.2026 nach Stufe 0.1.
Setzt `docs/foodnotify-api-inventar.md` und
`docs/foodnotify-0-1-nummernraum.md` voraus.

**Was sich am 01.08. geändert hat:** Die POS-Zuordnung ist gefunden und
auslesbar — über die `connectionId`, nicht über eine Account-ID. Die „offene
Flanke" aus §3.3 ist geschlossen, dafür ist eine neue Grenze aufgetaucht: nur
vier von 27 Aposto-Kostenstellen haben überhaupt eine Kassenanbindung.
Einzelheiten in `docs/foodnotify-0-1-nummernraum.md`.

**Neue Vorgabe von Eugene:** LINAs Warenwirtschaft und Einkauf werden nicht
genutzt — die Werte dort sind Demodaten. Sie werden nicht importiert und dürfen
überschrieben werden.

---

## 1. Was damit hinfällig wird

`PROMPT-stammdaten.md` sah vor, LINAs WAWI zu sichern. **Dieser Teil entfällt
ersatzlos.** Konkret nicht mehr holen:

| Endpunkt | Status |
|---|---|
| `/wawi/api/items` (898 Waren mit Preisen) | **Demodaten, streichen** |
| `/wawi/api/suppliers` (540 Lieferanten) | **Demodaten, streichen** |
| `/wawi/api/orders` (4 Bestellungen) | **Demodaten, streichen** |
| `/wawi/inventory/inventory` (11 Termine) | **Demodaten, streichen** |
| `/wawi/api/units` (32 Einheiten) | streichen — FoodNotify liefert eigene |

Die vier Zeilen im Rückblick: Dass dort nur 4 Bestellungen und 11
Inventurtermine standen, hätte mich stutzig machen sollen. Ich habe es als
„hängt am Zentral-Kontext" gedeutet. Es war schlicht ein leeres Modul.

**Was aus `PROMPT-stammdaten.md` bleibt:**

* `articleApi?franchise=1` — die Sortimentshierarchie je Artikel (8 Groß-, 329 MEC-, 278 Detailkategorien). Das ist echtes Verkaufsstammdatum, nicht WAWI.
* `analyticsFilterOptions` — die 334 Feinsparten.

**Und eine Folge, die weiter reicht:** `core.artikel.fixer_we` stammt aus dem
Artikelverkaufsbericht und gilt als „Ergebnis der LINA-Rezepturkalkulation".
Wenn Rezepturen in FoodNotify gepflegt werden und LINAs WAWI Demodaten enthält,
ist auch `fixer_we` fragwürdig.

**`mart.pruefung_wareneinsatz` wird deshalb stillgelegt** (Stufe 0.3) und später
auf FoodNotifys Zutatenkosten neu gebaut — dann mit dem Bar/Küche-Split, den sie
bisher nicht bilden konnte. Bis dahin gilt: keine Entscheidung auf dieser Sicht
aufbauen.

Eine Restchance bleibt: Über die LINA-FoodNotify-Kopplung fließen Rezepturen von
FoodNotify **nach** LINA. `fixer_we` könnte also doch echt sein. Ein
Stichprobenvergleich gegen FoodNotifys Zutatenkosten klärt das in Stufe 2.4 —
falls es passt, ist die alte Sicht schneller wiederhergestellt als neu gebaut.

---

## 2. Die drei Begriffe, die nicht vermischt werden dürfen

Das ist der konzeptionelle Kern. Beide Systeme sagen „Artikel" und meinen
Verschiedenes.

| Begriff | System | Bedeutung | Tabelle |
|---|---|---|---|
| **Artikel** | LINA | was verkauft wird — die Position auf dem Bon | `core.artikel` |
| **Rezept** | FoodNotify | woraus ein verkaufter Artikel besteht | `core.rezept` |
| **Ware** | FoodNotify | was eingekauft wird — Rohware, Zutat | `core.ware` |

Die Kette, die wir herstellen wollen:

```
core.artikelverkauf_tag   (LINA: wie oft wurde was verkauft)
        ↓  artikelnummer = pos_artikel.plu → pos_artikel.rezept
core.rezept + core.zutat  (FoodNotify: woraus besteht es)
        ↓  Zutat → Ware
core.ware                 (FoodNotify: Rohware)
        ↓  Ware → Beleg
core.bestellposition      (FoodNotify: was hat sie gekostet, wann)
```

Ist diese Kette geschlossen, lassen sich Fragen beantworten, die heute
unbeantwortbar sind: theoretischer Wareneinsatz je Betrieb und Tag, Marge je
Gericht, Auswirkung einer Einkaufspreisänderung auf den Deckungsbeitrag.

---

## 3. Die drei Verknüpfungen — und wie sicher sie sind

### 3.1 Betrieb ↔ Kostenstelle · **gelöst, aber Handarbeit**

Ein LINA-Betrieb entspricht **zwei** FoodNotify-Kostenstellen (Bar und Küche).
Die Namen matchen nicht zuverlässig: LINA sagt „Aposto Karlsruhe GmbH",
FoodNotify „Bar Aposto Karlsruhe" und „Küche Aposto Karlsruhe" — mal mit
Leerzeichen am Ende, mal mit typografischem Apostroph („Lehner’s" gegen
„Lehner´s").

**Lösung:** `manual.betrieb_fremd_id` existiert genau dafür. Ein Eintrag je
Kostenstelle mit `system = 'foodnotify'`. Etwa 150 Zuordnungen über vier Marken,
einmalig gepflegt.

Namensähnlichkeit darf als **Vorschlag** dienen, nie als automatische Zuordnung.
Die Bar/Küche-Trennung ist zugleich ein Gewinn: Damit wird der Split möglich,
den `mart.pruefung_wareneinsatz` bisher nicht bilden konnte.

### 3.2 Zutat ↔ Ware ↔ Beleg · **innerhalb FoodNotify sicher**

`zutat.artikelId` und `bestellposition.shopOrderMappingProduct.concreteProduct.id`
zeigen beide auf dieselbe FoodNotify-Ware. Diese Verknüpfung ist systemintern
und braucht kein Matching.

### 3.3 Artikel ↔ Rezept · **gelöst am 01.08.2026**

Die Brücke ist `plu`:

```text
core.artikel.artikelnummer  ==  /api/pos/mapping/{connectionId}/articles → items[].plu
                                                                        → items[].recipeId
```

Der Parameter ist die **`connectionId`** aus `/api/pos/locations` — nicht die
erpId, nicht die Kostenstelle, nicht das Restaurant. Deshalb liefen die
Versuche im Inventar alle ins Leere: die durchprobierten IDs kamen aus den
falschen Namensräumen.

Belegt an „Küche Aposto Gera": 1.283 POS-Artikel, 95,6 % der `plu` treffen
eine `artikelnummer`, **99,7 % davon namensgleich** — gegen eine
Zufallserwartung von 0,3 %. `deviceType.matchingStrategy` steht auf `plu`;
FoodNotify ordnet selbst so zu.

**Die Grenze liegt jetzt woanders — bei der Abdeckung:**

* **4 von 27 Aposto-Kostenstellen** haben überhaupt eine Kassenanbindung
  (Gera und Wuppertal, je Bar und Küche).
* Die Brücke trägt **nur bei `deviceType.name = amadeus`** — das ist unser
  Datenstrom. Wuppertal läuft auf `ikentoo` mit eigenem, kleinem Nummernkreis
  (PLU 8–580); dort liefert der Gegentest 67 % Zufallstreffer, der Abgleich
  ist wertlos.
* Von 1.283 POS-Artikeln in Gera sind erst **146 einem Rezept zugeordnet**
  (11 %). Die Zuordnung ist auslesbar, aber kaum gepflegt.

Damit ist die Kette technisch geschlossen und fachlich dünn. Der Notbehelf
über `posRecipeName` wird nicht gebraucht.

**Was `zutat.artikelId` stattdessen ist:** eine Lieferanten-Artikelnummer für
Rohware („Zwiebeln Rot Sack 10Kg"), dieselbe Art Schlüssel wie
`shopArticleId` in den Inventurpositionen. Sie zeigt auf `core.ware`, nicht
auf `core.artikel`. Stichprobe: 4 von 47 Treffern, alle auf Artikel ohne
Namen, keiner bestätigbar.

Der Einkaufsteil hängt ohnehin nicht am POS-Mapping.

---

## 4. Was geholt wird

Priorität nach Nutzen ÷ Risiko, nicht nach Vollständigkeit.

### Stufe A — sofort, unabhängig von allen offenen Fragen

**A1 · Organisation** (wenige Aufrufe je Marke)
```
/api/profile                                → Benutzer-ID
/api/core/business/{userId}/restaurants     → Betriebe
/api/erp/all                                → Kostenstellen mit erpId
/api/pos/locations                          → Kassenanbindung je Kostenstelle
```
→ `core.kostenstelle` (marke, erp_id, kostenstelle_id, restaurant_id, name, art,
connection_id, kassensystem)
`art` = `bar` | `kueche` | `sonstige`, aus dem Namen abgeleitet und **manuell
bestätigt**.

`/api/pos/locations` liefert je Kostenstelle `restaurantId`, `costCenterId`
und — wo eine Kasse hängt — `connection.connectionId` samt
`deviceType.name`. Beides gehört ins Modell: die `connectionId` ist der
Schlüssel für A5, `deviceType.name` entscheidet, ob die PLU-Brücke trägt
(nur bei `amadeus`).

**A2 · Bestellungen und Einkaufspreise** — der eigentliche Gewinn
```
/api/{erpId}/shop-order/paginate?order_by=timeCreated&order_direction=ASC
/api/{erpId}/shop-order/{orderId}
/api/{erpId}/shop-order/{orderId}/change
```
→ `core.bestellung`, `core.bestellposition`, `core.lieferant`

Aufsteigend sortiert einreihen, damit der Backfill chronologisch von 2021
vorwärts läuft und ein Abbruch nichts kaputt macht.

**A3 · Rezepturen**
```
/api/recipes?page=N
/api/recipes/{id}/ingredients
/api/recipes/{id}/meta        (Allergene — später für die Speisekarte)
```
→ `core.rezept`, `core.zutat`

**Rekursiv:** `zutat.subRecipeId` heißt, Rezepte enthalten Rezepte. Die
Auflösung braucht eine `WITH RECURSIVE`-Sicht mit Zyklusschutz. Kosten dürfen
erst auf der untersten Ebene summiert werden.

**A4 · Warenstamm**
```
/api/{erpId}/products?stocktakingVisibility=visible
/api/erp/commodity-groups, /api/erp/product-groups, /api/{erpId}/product-unit
```
→ `core.ware`, `core.warengruppe`, `core.einheit`

**Als Monatsmomentaufnahme**, wie `core.artikel_stand` — `pricePerUnit` und
`stock` ändern sich, und ohne Historie ist keine Rückrechnung möglich. Der
Fehler aus `0007` soll sich nicht wiederholen.

**A5 · POS-Zuordnung** — neu seit 0.1, wenige Aufrufe
```
/api/pos/mapping/{connectionId}/articles       → plu, name, recipeId, price, vat
/api/pos/mapping/{connectionId}/link-targets   → alle Rezepte als Zuordnungsziele
```
→ `core.pos_artikel` (kostenstelle, plu, name, rezept, preis, mwst, ignoriert)

Ein Aufruf je Kassenanbindung, bei Aposto also vier. Das ist der billigste
Posten des ganzen Imports und zugleich der, der die Kette schließt.

**Ebenfalls als Momentaufnahme**, aus demselben Grund wie A4: Die Zuordnung
wird gepflegt, `recipeId` ändert sich. Wer wissen will, welches Rezept im
März hinter einem Artikel stand, braucht den Stand von März.

**Nur `amadeus` auswerten.** Bei anderen Kassensystemen ist `plu` ein fremder
Nummernkreis und der Join gegen `core.artikel` falsch — er würde stillschweigend
Unsinn treffen, weil kleine Nummern bei uns dicht besetzt sind. Das gehört als
Bedingung in die Sicht, nicht in eine Konvention.

### Stufe B — nach Klärung

**B1 · Inventuren** — nur bei Wilma Wunder (275) lohnend, sonst Handvoll
```
/api/erp/stocktakings?erpIds[]=…      (Array! alle Kostenstellen auf einmal)
/api/erp/stocktakings/{uuid}/items
```
→ `core.inventur`, `core.inventurposition`
Felder: Sollbestand, gezählte Menge, Preis je Basiseinheit — bewertbarer Schwund.

**B2 · Verkäufe — gestrichen am 01.08.2026.**
```
/api/{erpId}/sales
```
100 % der Stichprobe stehen auf `saleStatus: init` mit einem Datenbankfehler
auf FoodNotify-Seite. **Wir brauchen sie ohnehin nicht:** es ist derselbe
Amadeus-Datenstrom, den wir aus LINA vollständig und funktionierend haben.
Sie zu importieren hieße, dieselbe Zahl ein zweites Mal zu holen — in der
kaputten Fassung.

**B3 · Kostenanalyse — gestrichen am 01.08.2026.**
```
/api/analytics/reports/cost-analysis/…
```
War als Vergleichsgröße gegen unsere eigene Rechnung geplant. Eine
Vergleichsgröße muss aber selbst belastbar sein, und diese ist es
nachweislich nicht: −2667 % Wareneinsatz bei Aposto, −30,50 € bei Enchilada,
0,54 % Soll bei Wilma Wunder. Sie taugt weder als Wahrheit noch als Prüfstein.

**Was an ihre Stelle tritt:** die eigene Rechnung aus 0.2 —
`artikelverkauf_tag.menge × zutat.cost`. Sie ist an einem Betrieb belegt
(19,8 %, plausibel) und hängt an keinem defekten Endpunkt.

`runner-bummer/ingredients` bleibt als **einziger** Cost-Analysis-Endpunkt
interessant, aber nicht als Import: Er liefert bei Aposto echte Zahlen und
kann einmalig zur Gegenprobe dienen, wenn unsere Deckungsbeitragsrechnung
steht. Als laufender Posten in der Warteschlange hat er nichts verloren.

### Nicht holen

Menu Creator, Marketplace, Catering, Stock-Transfer (vorerst), Tableau,
B.E.A.M. — sowie alles, was Personenbezug trägt.

---

## 5. Datenmodell

Kein neues Schema. `core` bleibt die fachliche Wahrheit; die Tabellen heißen
nach dem Begriff, nicht nach dem System. Kollisionen gibt es nicht, weil LINAs
Tabellen nach LINA-Berichten benannt sind (`umsatzbericht_tag`,
`artikelverkauf_tag`, `kennzahlen_monat`).

```sql
core.marke                (4 Zeilen: enchilada, deutsche_konzepte, wilma_wunder, aposto)
core.kostenstelle         marke, erp_id, kostenstelle_id, restaurant_id, name, art,
                          connection_id, kassensystem   -- NULL = keine Kasse angebunden
core.pos_artikel          kostenstelle, monat, plu, name, rezept, preis, mwst, ignoriert
core.rezept               marke, fn_id, name, erstellt_am, gruppe
core.zutat                rezept, position, ware, sub_rezept, menge, einheit, kosten
core.ware                 marke, fn_id, name, einheit, warengruppe
core.ware_stand           ware, monat, preis_je_einheit, bestand     -- Momentaufnahme
core.lieferant            marke, fn_id, name
core.bestellung           kostenstelle, fn_id, bestellnummer, lieferant, bestellt_am,
                          geliefert_am, status, summe, beleg_nummer, beleg_datum
core.bestellposition      bestellung, ware, menge, gebinde, einheit, einzelpreis,
                          summe_preis, preis_abweichend
core.inventur             kostenstelle, fn_uuid, name, art, status, erstellt_am, positionen
core.inventurposition     inventur, ware, soll_menge, gezaehlt_menge, preis_je_basiseinheit
```

**Jede Tabelle trägt die Marke.** Vier getrennte Mandanten mit eigenen
Zugangsdaten, eigenen ID-Räumen und — wie gemessen — eigenen Antworthüllen.
Ohne Mandantenspalte kollidieren die IDs beim ersten Import.

`manual.betrieb_fremd_id` verbindet `core.betrieb` (LINA) mit
`core.kostenstelle` (FoodNotify).

**`core.pos_artikel` verbindet `core.artikel` mit `core.rezept`** — über
`plu = core.artikel.artikelnummer`. Das ist die einzige Stelle, an der die
beiden Systeme fachlich zusammentreffen, und sie gilt nur, wo
`kostenstelle.kassensystem = 'amadeus'`. Die Bedingung gehört in die Sicht,
nicht in den Kopf des Lesers.

---

## 6. Was der Importer anders machen muss als bei LINA

**Drei Antworthüllen.** Rekursiv `payload` und `data` auflösen. Bei Wilma Wunder
hat mich das erste Auspacken 275 Inventuren übersehen lassen — lautlos, HTTP 200,
leeres Ergebnis.

**Leere Antworten sind verdächtig.** Anders als bei LINA (wo HTTP 500 mit leerem
Body ein Normalzustand ist) gehört bei FoodNotify eine 200er-Antwort mit null
Zeilen nach `sync.schema_abweichung`, sobald für dieselbe Kombination schon
einmal Daten kamen.

**Vier Zugänge statt einem.** `LinaSession` nimmt ihren `Zugang` seit dem
Auth-Umbau als Wert entgegen — das trägt hier. Was fehlt: Zugangsdaten je Marke
in der Konfiguration und ein Mandantenfeld in `sync.warteschlange`.

Jede Marke ist ein eigener Mandant mit eigenem Konto — bestätigt am
01.08.2026: der Aposto-Zugang sieht ausschließlich die 14 Aposto-Betriebe,
kein Markenwechsel möglich. Also **acht Variablen, zwei je Marke**:

```
FN_BASE_URL=https://my.foodnotify.com

FN_APOSTO_USER / FN_APOSTO_PASSWORD
FN_ENCHILADA_USER / FN_ENCHILADA_PASSWORD
FN_DEUTSCHE_KONZEPTE_USER / FN_DEUTSCHE_KONZEPTE_PASSWORD
FN_WILMA_WUNDER_USER / FN_WILMA_WUNDER_PASSWORD
```

Der Variablenname trägt den Markenschlüssel aus `core.marke`, damit die
Zuordnung ohne Übersetzungstabelle lesbar bleibt.

**Nicht alle vier müssen gesetzt sein.** Wer nur Aposto durchsticht, setzt
nur Aposto. Die Prüfung beim Start gilt je Marke: entweder Benutzer **und**
Passwort, oder keins von beidem — ein halb gesetztes Paar ist ein
Konfigurationsfehler und muss beim Hochfahren auffallen, nicht mitten im
Backfill. Marken ohne Zugangsdaten werden übersprungen, sichtbar geloggt.

**Der Fallstrick aus `.env.example` gilt hier genauso:** Passwörter mit
Sonderzeichen gehören in Anführungszeichen, und jedes `$` muss als `\$`
maskiert werden — Bun expandiert `$name` auch in einfachen Anführungszeichen,
und `#` beginnt einen Kommentar. Am 25.07.2026 wurden aus 25 Zeichen so
stillschweigend acht, und die Fehlersuche lief tagelang in die falsche
Richtung. Der Start loggt deshalb die Passwortlänge je Marke, nie das
Passwort.

**Und die Regel gegen Kontosperren gilt verschärft:** Anmeldefehler werden
nie wiederholt (AGENTS.md, Regel 7). Bei vier Konten heißt das auch, dass ein
Fehlschlag bei einer Marke die anderen drei nicht mitreißen darf — sonst
sperrt ein falsches Passwort vier Zugänge statt einen.

**Ein Importer, nicht zwei.** FoodNotify kommt in den bestehenden Dienst: ein
Endpunktregister, eine Warteschlange, ein Worker, eine Drosselung, eine
Datenbank. Die Quellsysteme unterscheiden sich (JWT statt Cookie, vier Mandanten
statt einem, drei Antworthüllen statt einer) — das rechtfertigt getrennte
Module unter `src/foodnotify/`, aber keinen zweiten Dienst. Der Gewinn: Rezept
und Verkauf treffen sich in derselben Transaktion, und es gibt weiterhin **eine**
Stelle, an der das Anfragetempo geregelt ist.

**Die Anmeldung, gemessen am 01.08.2026** — das Inventar vermutete JWT im
`localStorage`, das stimmt so nicht:

* Im `localStorage` steht **kein Token**, nur Oberflächeneinstellungen
  (`foodnotify.erp.selectedErp` und ähnliches).
* `/api/profile` antwortet trotzdem mit 200. Die Sitzung hängt an einem
  **HttpOnly-Session-Cookie**, das für JavaScript unsichtbar ist.

Das ist dasselbe Muster wie bei LINA — und damit trägt `src/lina/auth.ts`
konzeptionell schon: Anmeldung über `POST /api/user/auth/signin_check`,
danach Cookie-Jar mitführen. Kein `Authorization`-Header nötig.

**2FA:** Ob die Konten damit geschützt sind, zeigt der erste automatisierte
Anmeldeversuch — dafür braucht es keine Rückfrage beim Anbieter. Verlangt die
Antwort einen zweiten Faktor, ist das der Moment, an dem ein eigener Zugang
nötig wird. **Bis dahin nicht auf Verdacht bauen.**

Der lesende Subuser (`/api/subusers`, `/api/subuser-roles`) bleibt die
sauberere Lösung gegenüber den geteilten Administratorkonten und lässt sich
in der Oberfläche selbst anlegen. Das ist eine Aufgabe für euch, kein
Blocker für den Importer.

**Und die Regel, die hier besonders zählt:** Anmeldefehler werden nie
wiederholt (AGENTS.md, Regel 7). Bei vier Konten ohne Support-Draht ist eine
Kontosperre nicht mehr eben zu klären.

**Anfragetempo gilt weiter.** Vier Marken heißen nicht viermal so schnell.
Dieselbe Drosselung, ein Worker, `erpIds[]` nutzen wo möglich.

---

## 7. Entscheidungen — getroffen am 27.07.2026

| | Entscheidung | Begründung |
|---|---|---|
| **Zuschnitt** | **Durchstich bei Aposto**, danach die drei anderen als Konfiguration | Aposto hat als einzige Marke die vollständige Bestellhistorie (11.578, 26 von 26 Kostenstellen, ab 10/2021). Zeigt in Tagen statt Wochen, ob die Kette trägt |
| **Backfill** | **Alles, ab Oktober 2021** | Vier Jahre Preisentwicklung sind die Grundlage jeder Margenbetrachtung. Was jetzt nicht geholt wird, kostet später dasselbe noch einmal |
| **`mart.pruefung_wareneinsatz`** | **Stilllegen**, später auf FoodNotify-Zutatenkosten neu bauen | Solange die Herkunft von `fixer_we` ungeklärt ist, liefert sie Zahlen, die niemand verantworten kann |
| **Architektur** | **Ein Importer**, FoodNotify kommt hinein | Ein Register, eine Warteschlange, ein Worker, eine Drosselung. Rezept und Verkauf treffen sich in derselben Transaktion |

**Nachtrag 01.08.2026 nach 0.1:**

| | Entscheidung | Begründung |
|---|---|---|
| **Artikel ↔ Rezept** | Über `plu` aus `/api/pos/mapping/{connectionId}/articles`, **nur bei `amadeus`** | 99,7 % Namensgleichheit gegen 0,3 % Zufallserwartung. Bei `ikentoo` ist `plu` ein fremder Nummernkreis und der Join still falsch |
| **POS-Zuordnung** | Als **Momentaufnahme je Monat**, wie `core.artikel_stand` | `recipeId` wird gepflegt und ändert sich. Ohne Stand keine Rückrechnung — derselbe Fehler wie in `0007` |
| **Erwartungshaltung** | Stufe 2.3 deckt vorerst **einen Betrieb** ab (Gera), nicht die Marke | 4 von 27 Kostenstellen haben eine Kasse, davon 2 mit `amadeus`. Das ist ein Prüfstand, keine Flächenauswertung |

---

## 8. Reihenfolge

### Stufe 0 — vor jedem Code, kostet Stunden statt Tage

**0.1 · Die entscheidende Abfrage — erledigt am 01.08.2026.**
Ergebnis in `docs/foodnotify-0-1-nummernraum.md`: Die Brücke ist `plu` aus
`/api/pos/mapping/{connectionId}/articles`, nicht `zutat.artikelId`. Belegt
mit 99,7 % Namensgleichheit gegen 0,3 % Zufallserwartung. Neue Grenze: nur
4 von 27 Aposto-Kostenstellen haben eine Kasse, und nur `amadeus` trägt.

**0.1b · Erledigt am 02.08.2026** — beim Vier-Marken-Durchstich gemessen
(`core.kostenstelle`, aus `/api/pos/locations` aller Mandanten):

| Marke | Kostenstellen | mit Kasse | Systeme |
|---|---|---|---|
| aposto | 27 | 4 | amadeus (2), ikentoo (2) |
| deutsche_konzepte | 32 | 2 | amadeus |
| enchilada | 58 | 7 | amadeus |
| **wilma_wunder** | **35** | **31** | **amadeus** |

**Die Erwartung dreht sich damit um.** Aus Aposto-Sicht sah die PLU-Brücke
nach einem Einzelfall aus (2 amadeus-Anbindungen). Tatsächlich gibt es
**42 amadeus-Anbindungen über vier Marken — und Wilma Wunder ist mit 31 von
35 Kostenstellen fast flächendeckend angebunden.** Stufe 2.3 ist dort keine
Stichprobe, sondern eine echte Flächenauswertung; zusammen mit den 275
Inventuren wird Wilma Wunder zur wichtigsten Marke für die Verbrauchsseite,
genau wie §8b des Inventars es von der anderen Seite her sah.

**0.2 · Entfällt — kein Support-Kontakt.** Entscheidung Eugene, 01.08.2026.
Geprüft, was daran wirklich hing:

| Punkt | Status |
|---|---|
| POS-Zuordnung | mit 0.1 selbst gefunden, Support nie nötig gewesen |
| Verkaufsfehler `root_recipe_id` | **blockiert nur B2 und B3 — beides brauchen wir nicht** |
| Lesender Subuser, 2FA | Sauberkeitsfrage, kein Blocker. Ob 2FA greift, zeigt der erste Anmeldeversuch |

**Warum der Verkaufsfehler uns nicht trifft.** Er verhindert, dass *FoodNotify*
aus seinen Verkäufen den Warenverbrauch abrechnet. Wir brauchen diese Rechnung
nicht: **die Verkaufsmengen haben wir aus LINA**, und die Zutatenkosten stehen
fertig am Rezept (`zutat.cost`, Euro je Portion). Der Soll-Wareneinsatz ist
damit unsere eigene Multiplikation, kein Import einer fremden Kennzahl:

```text
core.artikelverkauf_tag.menge  ×  Σ zutat.cost  =  Soll-Wareneinsatz
        (LINA, funktioniert)      (FoodNotify, gepflegt)
```

**Gemessen am 01.08.2026**, Aposto Gera, Juni 2026, aus 40 der 146
zugeordneten Rezepte: 2.902,58 € Soll-Wareneinsatz auf 14.660,83 € Umsatz =
**19,8 %**. Ein plausibler Wert (üblich sind 25–33 %, und hier fehlen noch
zwei Drittel der Rezepte, überwiegend Speisen).

FoodNotifys eigene Kostenanalyse weist für dieselbe Marke **−2667 %** aus.
**Unsere Rechnung funktioniert, ihre nicht** — und unsere umgeht genau die
Kette, die bei ihnen bricht.

Damit ist der Fehler kein Blocker, sondern ein Grund mehr, die Kostenanalyse
(B3) gar nicht erst als Wahrheit zu importieren. Sie war ohnehin nur als
Vergleichsgröße geplant; der Vergleich fällt weg, die eigene Rechnung bleibt.

**0.3 · Migration `0029`: `mart.pruefung_wareneinsatz` stilllegen.** Als
`DROP VIEW`, nicht auskommentiert — mit einem Kommentar in der Migration, der
sagt warum und was an ihre Stelle tritt. `mart.pruefung_uebersicht` verweist auf
sie und muss mit angepasst werden.

*(Der Plan nannte ursprünglich `0009`. Die Nummer ist längst vergeben; Stand
am 01.08.2026 ist `0028`.)*

Ein zusätzliches Argument für die Stilllegung, aus 0.1: `fixer_we` ist bei
20.808 von 21.287 Artikeln null, belegt nur bei 479. Die Sicht rechnet auf
2,2 % der Artikel — unabhängig davon, woher die Werte stammen.

### Stufe 1 — Aposto durchstechen

| | Was | Voraussetzung |
|---|---|---|
| 1.1 | **✅ erledigt 01.08.2026** — Migration `0030`: `core.marke`, `kostenstelle`, `pos_artikel`, `rezept`, `zutat`, `ware`, `ware_stand`, `warengruppe_fn`, `lieferant`, `bestellung`, `bestellposition` | — |
| 1.2 | **✅ erledigt 02.08.2026** — Migration `0031`: `marke_key` in `sync.warteschlange` (NULL = LINA), Unique-Index je Mandant; `config.ts`: `FN_*`-Paare mit Startprüfung, `fnZugaenge()` | — |
| 1.3 | **✅ erledigt 02.08.2026** — `src/foodnotify/huelle.ts`: `auspacken()` löst alle vier gemessenen Hüllen rekursiv, `istLeer()` liefert das Signal für „leere 200er ist verdächtig"; 15 Tests inkl. Wilma-Wunder-Fall | — |
| 1.4 | **✅ erledigt 02.08.2026** — `src/foodnotify/`: Anmeldung (`signin_check`, Cookie, 2FA bricht ab), Register `fn:*` (A1+A2), gedrosselter Client (ein Takt, Sessions und Anmeldesperre je Marke), `fnLaden` (Raw + Leere-200er-Regel via Migration `0032`), Worker-Verzweigung. **FN-Sperren vertagen nur die Marke, nie den Importer.** Vier e2e-Tests | 1.2, 1.3 |
| 1.5 | **✅ gebaut 02.08.2026, Start ausstehend** — `bun run einreihen --foodnotify` reiht A1 je konfigurierter Marke ein; der Rest steuert sich selbst: Kostenstellen → Bestellseiten (chronologisch aufsteigend) → Köpfe + Positionen + Folgeseite, alles in einer Transaktion je Posten (Migration `0033`, `src/foodnotify/transform.ts` + `laden.ts`). Detail-Posten tragen das Bestelldatum als Zeitraum — der Fortschritt zeigt das Backfill-Jahr | 1.4 |
| 1.6 | **✅ erledigt 02.08.2026** — Migration `0034`: `manual.betrieb_zuordnung` schlägt vor (`core.name_norm` + Trigramm + doppelt gewichtete Wortüberschneidung), der Mensch entscheidet. **125 von 152 Kostenstellen (82 %) automatisch zugeordnet**, alle 62 getroffenen Betriebe haben nachweislich LINA-Umsatz. 12 Fälle warten sichtbar in `manual.betrieb_zuordnung_offen` | 1.1 |
| 1.7 | **✅ erledigt 02.08.2026** — Migration `0035`: `mart.einkauf_position`, `einkaufspreis_monat` (Median je Einheit, gruppiert über den **Namen** — 866 Warensätze tragen nur 428 Namen), `einkaufspreis_veraenderung` (nur echter Vormonat), `einkauf_betrieb_monat`, `einkauf_ladestand`. Metabase: neues Dashboard **Einkauf** mit vier Karten, `wa_preise` kehrt mit Belegpreisen zurück | 1.5 |

**Nach 1.7 ist die Ausgangsfrage beantwortet** — Einkaufspreise und ihre
Entwicklung über vier Jahre, ohne Rezepturen, ohne POS-Mapping, ohne
Kostenanalyse.

### Stufe 2 — Rezepturen und Verzahnung

| | Was |
|---|---|
| 2.1 | Rezepturen Aposto holen (672 Stück), `WITH RECURSIVE` mit Zyklusschutz für `subRecipeId` |
| 2.2 | Warenstamm als Monatsmomentaufnahme (`core.ware_stand`) |
| 2.3 | POS-Zuordnung holen (A5) und `core.artikelverkauf_tag` über `plu` an `core.rezept` hängen — **nur `amadeus`** |
| 2.4 | Mart-Sicht **Deckungsbeitrag je Rezept**, und `pruefung_wareneinsatz` neu auf Zutatenkosten |

**Erwartung an 2.3 richtig stellen:** Nach heutigem Stand deckt die
Verknüpfung **einen Betrieb** ab (Aposto Gera, Bar und Küche), und dort 146
von 1.283 Artikeln. Das ist genug für einen Prüfstand — theoretischer
Wareneinsatz gegen tatsächlichen, an einem Betrieb mit echten Zahlen —, aber
keine Flächenauswertung. Ob mehr daraus wird, entscheidet 0.1b und die
Pflege der Zuordnung bei Concept Family, nicht der Importer.

### Stufe 3 — die übrigen drei Marken

Reine Konfiguration, wenn Stufe 1 und 2 stehen: Zugangsdaten, Einträge in
`core.marke`, Zuordnungen in `manual.betrieb_fremd_id`, Warteschlange füllen.
Rund 100 weitere Zuordnungen von Hand.

### Stufe 4 — Inventuren, wenn jemand danach fragt

~~Nur noch **Inventuren** (B1). Sie hingen nie am Verkaufsfehler: gezählte
Menge, Sollbestand und Preis je Basiseinheit stehen unabhängig davon in
`/api/erp/stocktakings/{uuid}/items`.~~

**✅ gebaut 04.08.2026, Start ausstehend** — Eugene hat gefragt. Migration
`0044`: `core.inventur` + `core.inventurposition` (Schema wie unten in §5
skizziert, `art`/`status` bewusst ohne CHECK — siehe Migrationskommentar).
Register `fn:inventuren` (bündelt ALLE Kostenstellen einer Marke in einem
Aufruf, `erpIds[]`) und `fn:inventurpositionen`, `src/foodnotify/inventur.ts`
(reine Transformation, eigene Datei wegen einer parallel laufenden Session
auf `transform.ts`), `src/foodnotify/laden.ts` (zwei neue Fälle, dieselbe
Rückwärts-Seiten-Strategie wie bei Bestellungen). Eigener Schalter
`bun run einreihen --foodnotify-inventuren` (B1 ist **kein** Teil des
laufenden Abgleichs in `nachfuellen.ts` — Begründung in
`docs/entscheidungen.md`, „Inventuren bleiben ein reiner Backfill").

**Eine Falle, die noch aussteht:** die Antworthülle von
`/api/erp/stocktakings` ist NICHT gemessen, nur aus dem Pfadmuster
`/api/erp/*` abgeleitet (Inventar §1). Der erste echte Abruf sollte von
Hand geprüft werden, bevor jemand den geladenen Zeilen traut — siehe den
`hinweis` an `fn:inventuren` in `src/foodnotify/endpunkte.ts`.

Lohnend ist das allein bei **Wilma Wunder** (275 Stück, 154 signiert). Bei
den anderen drei Marken gibt es praktisch keine — Aposto 19, Deutsche
Konzepte 9, davon fünf storniert. Eine inventurgestützte Schwundrechnung ist
dort nicht möglich.

Verkäufe und Kostenanalyse sind gestrichen, siehe Stufe B.
