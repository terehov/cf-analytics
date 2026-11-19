# FoodNotify: belegte Mängel

**Stand 19.11.2026.** Auftrag vom 19.11.2026: alle Befunde an einer Stelle sammeln, die sich später gegenüber FoodNotify
vorbringen lassen. Concept Family ist zahlender Kunde von FoodNotify (Einkauf, Warenwirtschaft, Rezepte, vier Marken). Die
Befunde sind beim Bau des Importers entstanden und standen bisher verstreut in `docs/`. Diese Datei ist **eine Sammlung, kein
Anschreiben**: Es ist **kein Kontakt zu FoodNotify geplant** (Entscheidungen vom 01.08.2026 und 18.11.2026 in
`entscheidungen.md`). Wer sie für ein Gespräch benutzt, entscheidet vorher, was er damit offenlegt (siehe nächster Absatz).

**Was ein Vorbringen offenlegt.** Fast alle Befunde stammen aus Messungen über die **interne** Schnittstelle der Weboberfläche
(Cookie-Sitzung, `my.foodnotify.com`) oder aus dem Scope-Token auf `api3.foodnotify.com`. Eine Meldung der Datenfehler (D1, D2)
legt offen, dass wir diese Schnittstelle nutzen — deshalb wurde D1 nicht gemeldet, sondern umgangen (`entscheidungen.md`,
19.10.2026). Aus **öffentlich ausgelieferten** Quellen ohne Anmeldung stammen nur: die OpenAPI-Spezifikation (A10), die
MCP-Metadaten und Hilfeseiten (A12), die beiden JavaScript-Bundles der Oberflächen (A11, S3 bis S5) — gelesen, nie ausgeführt.
Zwei Wirkungen (A1, A2) haben wir selbst ausgelöst, bei rein lesender Absicht; das gehört zur Wahrheit dieser Befunde.

**So wird die Datei gepflegt.**

* Neuer Befund = neue Zeile in der Tabelle und ein Einzelbefund darunter, **mit Datum der Messung und Quelldatei** (Datei und
  Abschnitt). Nichts schärfer formulieren als die Quelle.
* Erledigtes **durchstreichen, nicht löschen** (`~~…~~`), mit Datum und Grund — wer nicht sieht, dass es einmal galt, stellt es
  neu auf.
* Was sich als **unser eigener Fehler** oder als Messfehler herausstellt, wandert in Abschnitt 5. Dort steht schon ein Beispiel
  (das Testrestaurant).
* Jeder Befund steht zuerst in der Datei, die für ihn zuständig ist (`fehlerkatalog.md`, `foodnotify-*.md`); hier steht die
  Kurzfassung mit Verweis.
* Keine Schlüsselwerte, Tokens, Passwörter oder Namen von Personen in diese Datei. Wo die Quelle einen Wert ausschreibt, steht
  hier nur die Fundstelle.

**Maßstab der Schwere.** Er richtet sich nach der Auswirkung auf *unsere* Zahlen oder auf Sicherheit und Betrieb, nicht nach der
Eleganz der Technik.

| Schwere | Bedeutung |
|---|---|
| **hoch** | gemessen, und es hat Daten vorenthalten, Zahlen verfälscht oder Daten des Kunden verändert; ohne Eingriff von FoodNotify nicht zu beheben, nur zu umgehen |
| **mittel** | Beeinträchtigung belegt, aber begrenzt oder umgehbar; **oder** ein Sicherheits-/Datenschutzbefund, der aus dem Code oder aus Antworten gelesen, nicht aber in seiner Wirkung beobachtet ist |
| **niedrig** | Unsauberkeit ohne belegte Folge für unsere Zahlen |
| **Hinweis** | Auffälligkeit, die die Quelle ausdrücklich nicht als Mangel führt; steht hier, damit sie in einem Gespräch nicht überrascht |

**Vorbehalte, die für die ganze Datei gelten.**

* Die Messungen der Schnittstelle vom 18. und 19.11.2026 betreffen **ein Konto (Wilma Wunder)**, je Pfad meist **einen Aufruf**.
  Für die drei anderen Marken ist nichts gemessen. Ausnahmen sind in der jeweiligen Zeile genannt.
* Was die Quellen aus dem Code der Oberflächen lesen, ist **nicht ausgeführt** worden.
* Der Stand eines Befunds gilt für den Tag der Quelle. Ob FoodNotify etwas inzwischen behoben hat, zeigt nur eine neue Messung.

---

## 1. Übersicht

Kategorien: **D** = Datenfehler und Funktionsausfälle, **A** = Schnittstelle, **S** = Sicherheit und Datenschutz.
Stand: *offen* = besteht nach unserem Wissen, *umgangen* = wir fangen es ab, der Mangel besteht weiter, *vermutlich behoben* =
am Messtag nicht mehr sichtbar, aber nicht am ursprünglichen Ort nachgemessen.

| Nr. | Mangel in einem Satz | Kat. | Schwere | seit / gemessen am | Stand | Quelle (Datei, Abschnitt) |
|---|---|---|---|---|---|---|
| D1 | Positionsabruf `/change` bricht mit `NonUniqueResultException` (HTTP 500) für 14 von 17 DISTRA-Bestellungen der Bar Enchilada Augsburg; ein Artikel steckt in allen 14 | D | hoch | seit 31.08.2026, gemessen 15. und 19.10.2026 | umgangen | `foodnotify-http500.md`, Nachträge 15.10. und 19.10.2026 |
| D2 | Derselbe Positionsabruf lieferte am 04.08.2026 für 282 Bestellungen deterministisch HTTP 500, später doch Daten; Ursache nie genannt | D | mittel | 04.08.2026 | überwiegend behoben, Ursache offen | `foodnotify-http500.md`, Nachträge 01.09. und 10.09.2026 |
| D3 | Verkaufsverarbeitung scheitert mit einem Datenbankfehler (`column t0.root_recipe_id does not exist`) bei jeder Stichprobe | D | hoch | 27.07.2026 | vermutlich behoben, nicht am Fundort nachgemessen | `foodnotify-api-inventar.md`, §8a |
| D4 | Die Kostenanalyse weist ohne Warnung Kennzahlen aus, die nicht stimmen können (Ist-Wareneinsatz minus 10 Mio. EUR bei 0,76 Mio. EUR Umsatz) | D | hoch | 27.07.2026 | offen, nicht nachgemessen | `foodnotify-api-inventar.md`, §8b |
| D5 | Gebindeangaben (`packagingQuantity`, `unitQuantity`) derselben Ware widersprechen sich: Preis je Kilo schwankt um den Faktor 1.275 und mehr | D | mittel | 03.08.2026 | umgangen | `fehlerkatalog.md` (03.08.2026), `migrations/0040`, `0042` |
| D6 | Felder an Bestellpositionen, die eine Menge oder einen Zustand nahelegen, sind leer oder 0 (`amount`, `isSubstituted`); `adjustedQuantity` trägt Rundungsreste | D | niedrig | 02. und 03.08.2026 | umgangen | `fehlerkatalog.md` (02.08. und 03.08.2026) |
| D7 | Bei 18 % der Bestellpositionen fehlt `concreteProduct.id`; die Warennummer ist nicht je Ware eindeutig | D | niedrig | 03.08.2026, 22.08.2026 | umgangen | `migrations/0042`, `fehlerkatalog.md` (22.08.2026) |
| D8 | Die Rezeptliste ist über die Seiten nicht stabil und zählt nicht alle Rezepte auf | D | mittel | 14. bis 17.09.2026, 15.10.2026 | umgangen | `foodnotify-api-inventar.md`, §3 |
| A1 | 15 GET-Aufrufe verändern etwas (14 aus dem Code der Oberfläche gelesen, davon einer beobachtet; der 15. gemessen, siehe A2); Seiten setzen sie beim bloßen Öffnen ab | A | mittel | 18.11.2026 | offen | `foodnotify-api-inventar-intern-2026-11.md`, §6 |
| A2 | Das **Lesen** eines Warenkorbs verschiebt dessen Liefertermin und setzt `timeUpdated`, ohne Fehler, ohne Hinweis | A | hoch | 19.11.2026 | offen | `payloads/foodnotify-2026-11/fn-probe-2026-11-19-warenkorb-verkaeufe.md`, Messung 1 |
| A3 | Ein fehlender oder ungültiger Pflichtparameter kommt je Endpunkt als 404, 422 oder 500 zurück; 404 heißt dann „Validierungsfehler", nicht „nicht vorhanden" | A | mittel | 18.11.2026 | umgangen | `foodnotify-interna-aus-fehlermeldungen.md`, §2 und §4 |
| A4 | `paginate` und `search` werden bei mehreren Ressourcen als ID gelesen und enden in Typ- oder SQL-Fehlern; es gibt keine einheitliche Listenroute | A | niedrig | 18.11.2026 | offen | `foodnotify-interna-aus-fehlermeldungen.md`, §3 |
| A5 | Pfade und Seiten ohne Funktion: ein Endpunkt verweist auf einen Dienst, den es im Container nicht gibt; Fehler ohne Text; eine Testseite in Produktion; drei verschiedene Bestellnummern | A | niedrig | 19.10. und 18.11.2026 | offen | `foodnotify-interna-aus-fehlermeldungen.md`, §2 und §3.4; `menue-durchgang-2026-11-18.md` |
| A6 | Antworthüllen und Seitenparameter sind uneinheitlich (drei Hüllen je Marke und Endpunkt, vier Benennungen der Seitensteuerung in einer Oberfläche, zwei Zeitformate) | A | mittel | 27.07. und 18.11.2026 | umgangen | `foodnotify-api-inventar.md`, §1 und §8b; `menue-durchgang-2026-11-18.md`, Auffälligkeit 8 |
| A7 | Große Antworten ohne Seitensteuerung; einzelne Abrufe brauchen 19 bis 39 s und brachen nachts ab | A | niedrig | 18. und 19.11.2026 | offen | `fn-probe-2026-11-19.md`, §1 und „Was offen bleibt"; `fn-probe-2026-11-19-tag.md`, §1 |
| A8 | Kein Änderungsdatum und kein Änderungsfilter an Rezepten, Bestellungen und Inventuren; die Detailantwort der Bestellung ändert sich ohne Änderung der Bestellung | A | niedrig | 25.08.2026, 15.10.2026 | umgangen | `importer.md` („2.144 der 2.960 …"), `foodnotify-api-inventar-offiziell.md`, „Datumsfilter" |
| A9 | Die öffentliche API ist mit dem einzigen anlegbaren Token nicht nutzbar (`full-access` fehlt, jedes gemessene `/api/1.0/…` 403); Bestellpositionen und Inventuren gehen nur über die interne Schnittstelle | A | mittel | 18.11.2026 | offen | `foodnotify-api-inventar-offiziell.md`, „Messung mit Token" und „Endstand" |
| A10 | Die OpenAPI-Spezifikation ist unvollständig und widersprüchlich (keine Sicherheitsschemata, Antwortfelder nur in 2 von 9 Dateien, Typfehler, keine Rate-Limits) | A | niedrig | 18.11.2026 | offen | `foodnotify-api-inventar-offiziell.md`, „Was die Spezifikation nicht sagt" |
| A11 | Mindestbestellwert, Liefertage und Bestellfrist sind nur über den Warenkorb-GET lesbar (der schreibt, A2); Bestellschlüsse für vier Lieferanten stehen fest im Oberflächencode | A | niedrig | 19.11.2026 | offen | `lieferkonditionen-bundle-2026-11-19.md`, §2 bis §5 |
| A12 | MCP-Server: öffentliche Beschreibung und angebotene Berechtigungen passen nicht zusammen; keine Anleitung, keine Werkzeugliste | A | niedrig | 18.11.2026 | offen | `foodnotify-mcp-server.md`, §2 und §6 |
| S1 | Fehlermeldungen geben Klassen, Dateipfade mit Zeilennummern, SQL-Fehler und Dienstnamen preis; Antwortköpfe nennen Server und PHP-Version | S | mittel | 27.07. und 18.11.2026 | offen | `foodnotify-interna-aus-fehlermeldungen.md`, §1 und §2; `foodnotify-api-inventar.md`, §11 |
| S2 | In Antworten stehen interne Objektfelder und Metaspalten (`Carbon…clock`, `dbMetaTimeCreated`) | S | niedrig | 18.11.2026 | offen | `foodnotify-interna-aus-fehlermeldungen.md`, §1 und §5 |
| S3 | Die alte Oberfläche zeichnet Sitzungen ohne Textmaskierung auf (10 % aller Sitzungen, 100 % bei Fehlern) und meldet jeden Benutzer mit Name und E-Mail an einen Drittdienst | S | mittel | gelesen 18.11.2026 | offen | `foodnotify-api-inventar-intern-2026-11.md`, §4 |
| S4 | Das Lieferantenportal schreibt bei „Angemeldet bleiben" E-Mail und Passwort im Klartext in den Browserspeicher | S | mittel | gelesen 18.11.2026 | offen | `payloads/foodnotify-2026-11/intern/panel-auth.md`, §5 |
| S5 | Ein Google-Maps-Browserschlüssel steht im Klartext in Bundle und HTML; ob er beschränkt ist, ist offen | S | niedrig | gelesen 18.11.2026 | offen | `intern/brew-auth.md`, §5; `intern/panel-auth.md`, §8 |
| S6 | Verwaltungspfade und -seiten von FoodNotify sind für Kundenkonten geroutet (Antwort 403, nicht 404) | S | Hinweis | 18.11.2026 | Auffälligkeit | `messung-sitzung-2026-11-18.md`, Auffälligkeit 5 |
| S7 | Lesepfade liefern Namen von Mitarbeitenden und Benutzerdaten (Bestellungen, Inventuren, Benutzerverwaltung) | S | Hinweis | 18.11.2026 | Auffälligkeit | `messung-sitzung-2026-11-18.md`, Auffälligkeit 9 |
| S8 | Zwei Wege zu Tableau nebeneinander; der alte gibt ein kurzlebiges Ticket per GET heraus | S | Hinweis | 18.11.2026 | Auffälligkeit | `messung-sitzung-2026-11-18.md`, Auffälligkeit 7 |
| S9 | FoodNotify-Mitarbeitende können sich als Kunde anmelden; die alte Oberfläche kennt in ihrem Code keine Zwei-Faktor-Anmeldung | S | Hinweis | gelesen 18.11.2026 | Auffälligkeit | `intern/brew-auth.md`, §3; `intern/panel-auth.md`, §3 und §6 |

**Zählung.** 29 Zeilen: 8 Datenfehler (3 hoch, 3 mittel, 2 niedrig), 12 Schnittstelle (1 hoch, 4 mittel, 7 niedrig), 5 Sicherheit
und Datenschutz (3 mittel, 2 niedrig), dazu 4 Hinweise.

---

## 2. Datenfehler und Funktionsausfälle

### D1 — Bestellpositionen der Bar Enchilada Augsburg: HTTP 500 `NonUniqueResultException`

**Beobachtet.** `GET /api/10262/shop-order/{id}/change` (Kostenstelle Bar Enchilada Augsburg, Lieferant DISTRA) antwortet seit
dem 31.08.2026 für fast jede Bestellung mit HTTP 500. Der Fehlertext lautet `{"statusCode":500,"title":"NonUniqueResultException",
"message":"More than one result was found for query although one row or none was expected."}`. Der Bestellkopf lädt.

* **15.10.2026**, Auswertung der geladenen Bestellungen 15.08. bis 10.10.2026: genau eine Kostenstelle im ganzen Konzern ist
  betroffen. Die Bestellungen 434 bis 450 (01.07. bis 25.08.) tragen 37 bis 66 Positionen; ab Bestellung 451 (31.08.) stehen
  **zwölf von dreizehn ohne eine einzige** (451 bis 461 und 463). Nur 462 (12.10.) lief durch (47 Positionen). Jede andere
  Kostenstelle, auch die Küche und die übrigen Lieferanten derselben Bar, lädt normal.
* **19.10.2026**, im Browser mit dem Zugang der Marke, nur lesend: derselbe Abruf scheitert auch in der Browser-Sitzung. Von
  17 DISTRA-Bestellungen (447 bis 463) antworten 14 mit 500 und 3 mit 200 (449, 450, 462). **Genau ein Artikel** (Pickled Onions
  Gelb 3Kg Eimer, DISTRA-Nummer 500081, `productId` 27826673) steckt in allen 14 kaputten und in keiner der 3 funktionierenden.
  Andere Betriebe bestellen dieselbe Nummer ohne Fehler. Auch 447 und 448, die beim ersten Abruf Positionen lieferten, scheitern
  seit dem Nachabruf Anfang September.
* In der Bar selbst: der Marktartikel ist unauffällig (ein Eintrag, ein Gebinde); im Warenstamm der Kostenstelle (8 Artikel) und
  unter „Meine Produkte" steht er nicht. **Die Listen-Seite der Bar (`/shop/6421/lists`) bricht selbst mit HTTP 500
  („Internal Server Error", ohne Grund) ab.** Die Quelle schließt daraus *vermutlich*, dass der Artikel in den Produktlisten der
  Bar doppelt hängt — **nicht bewiesen**.
* In der **Oberfläche** öffnen sich dieselben Bestellungen vollständig (Bestellung 451 intern, Oberflächennummer 645599: 44
  Artikel, 1.587,37 EUR).

**Kosten / Risiko.** Rund 25.000 EUR Bar-Einkauf standen ohne Positionen da (`migrations/0135`). Jede Auswertung über Warenpreise
hätte diese Belege nicht gesehen, ohne Fehlermeldung. Wiederholungen helfen nicht (Bestellung 451 stand nach sechs Wochen weiter
ohne Positionen). Der Fehler ist an den Artikel gebunden, nicht an Tempo oder Zugang (kein 429 im ganzen Zeitraum).

**Umgehung.** Der Importer liest für solche Bestellungen die HTML-Bestellansicht (`/shop/{shopId}/orders/{nr}`, Migration
`0135`). An Bestellung 450 stimmen Artikelnummer, Menge, Gebinde und Summe in 53 von 53 Positionen mit `/change` überein; es
fehlen Inhalt je Gebindestück und Basiseinheit (aus der jüngsten Schnittstellen-Position entlehnt). Mit dem Importer-Zugang am
19.10.2026: 44 von 44 Zeilen. Die Nachprüfung nach zwei Nächten (`mart.bestellansicht_stand`, Erwartung `ohne_positionen = 0`)
ist in `docs/` nicht festgehalten — vor einer Verwendung dort nachsehen.

**Offen, bei FoodNotify zu klären:** welcher Datensatz doppelt ist und wie er entstand (die Quelle datiert die Dopplung auf etwa
den 31.08.2026); ob die Produktlisten der Bar sich in der Oberfläche überhaupt korrigieren lassen (die Listen-Seite öffnet
nicht).

**Beleg.** `foodnotify-http500.md`, Nachträge 15.10.2026 und 19.10.2026; `offene-punkte.md`, Abschnitt
„FoodNotify: Bar Enchilada Augsburg / DISTRA lädt seit 31.08.2026 keine Positionen"; `entscheidungen.md`, 19.10.2026;
`migrations/0135_bestellansicht_ersatzweg.sql`.

### D2 — Frühere HTTP-500 auf `/change` bei 282 Bestellungen

**Beobachtet am 04.08.2026.** Nachgemessen an 4.092 Abrufen innerhalb von sechs Stunden: 282 bestimmte Bestellungen lieferten bei
**allen** drei bis vier Versuchen HTTP 500, 3.821 Bestellungen nie. Kein einziger 429; die Anmeldung war gültig, derselbe Zugang
lieferte unmittelbar davor und danach andere Bestellungen. Verteilung: Enchilada 271, Wilma Wunder 8, Aposto 3; Bestelljahre
2022 bis 2026 (2025: 88, 2023: 82). Der Fehlerkörper enthielt damals keine verwertbare Meldung.

**Verlauf.** Die Wiederbelebung der aufgegebenen Posten holte später **282 von 292** dieser Bestellungen doch (`foodnotify-http500.md`,
Nachtrag 01.09.2026); zehn fehlten weiter, alle Enchilada, Juli/August 2026. Der Nachtrag vom 10.09.2026 stellt klar: Sie kamen
nicht, weil sich bei FoodNotify nachweislich etwas bewegte, sondern weil der Zeitplan sie erst 9 bis 11 Tage nach dem ersten
Fehler wieder fragte. „Dauerhaft deterministisch" galt also nur am Messtag. Ob die zehn verbliebenen dieselbe Ursache wie D1
haben, ist in der Quelle nicht geklärt; die Einordnung vom 15.10.2026 sieht zehn der fünfzehn aufgegebenen Posten bei den
Bestellungen 439 bis 448 der Bar Augsburg.

**Kosten / Risiko.** Etwa 1 % aller Bestellungen standen mit Kopf, aber ohne Positionen da. Seit dem 10.09.2026 meldeten fast alle
Läufe `teilweise` wegen 3 bis 13 Postenfehlern je Nacht, überwiegend HTTP 500 auf Bestellpositionen (`offene-punkte.md`, 05.10.2026).

**Beleg.** `foodnotify-http500.md` (Hauptteil und Nachträge 01.09. und 10.09.2026); `fehlerkatalog.md`, „320 Bestellungen mit Kopf und
ohne eine einzige Position (03.08.2026)"; `befunde-datenlage.md`, „322 Bestellungen ohne eine einzige Position".

### D3 — Verkaufsverarbeitung mit Datenbankfehler

**Beobachtet am 27.07.2026** (Marke Wilma Wunder, 8 Kostenstellen; Marke Aposto). `GET /api/{erpId}/sales` liefert Verkäufe aus
dem Kassensystem (`saleType: amadeus`), über die FoodNotify den Warenverbrauch aus den Rezepturen abrechnet. Jeder geprüfte
Datensatz stand auf `saleStatus: init`, `sumPrice: 0` und trug in `finishError`:

```
SQLSTATE[42703]: Undefined column: 7 ERROR: column t0.root_recipe_id does not exist
```

Ein Datenbankfehler auf FoodNotify-Seite: der Code erwartet eine Spalte, die das Schema nicht hat.

| Kostenstelle (Wilma Wunder) | Verkäufe | Stichprobe | mit Fehler |
|---|---|---|---|
| Bar Dresden | 123.786 | 25 | 25 |
| Bar Freudenstadt | 3.971 | 25 | 25 |
| sechs weitere | 0 | — | — |

Bei Aposto: 20.157 Verkäufe, die Quelle führt „davon mit Fehler 100 %" (`foodnotify-api-inventar.md`, §8b); Umfang der Stichprobe
dort nicht genannt.

**Stand.** In der Sitzungsmessung vom 18.11.2026 stand bei Wilma Wunder in zehn Probezeilen `finishError: null`. Am 19.11.2026
trugen an drei Kostenstellen (Bar und Küche Ballplatz Mainz, Bar Karlsruhe) 3.000 von 3.000 Zeilen `finish` ohne Fehler. **Das
beweist keine Behebung:** diese Kostenstellen sind erst seit 12.08. bzw. 15.09.2026 angebunden, also nach der Messung vom
27.07.; die damals betroffenen Kostenstellen (Bar Dresden, Bar Freudenstadt, Aposto) sind nicht nachgemessen.

**Kosten / Risiko.** Bei uns keine, wir nehmen die Verkaufsmengen aus LINA (Entscheidung 01.08.2026). Für FoodNotify-Kunden: Die
Soll-Wareneinsatzrechnung in FoodNotify hängt an dieser Kette (siehe D4).

**Beleg.** `foodnotify-api-inventar.md`, §8a und §8b, Nachtrag 18.11.2026; `payloads/foodnotify-2026-11/messung-sitzung-2026-11-18.md`,
Befund 7; `…/fn-probe-2026-11-19-warenkorb-verkaeufe.md`, Messung 2; `entscheidungen.md`, 01.08.2026.

### D4 — Kostenanalyse mit unplausiblen Kennzahlen, ohne Warnung

**Beobachtet am 27.07.2026** (`/api/analytics/reports/cost-analysis/…`, alle vier Marken, Zahlen laut Kostenanalyse):

| | Enchilada | Deutsche Konzepte | Wilma Wunder | Aposto |
|---|---|---|---|---|
| POS-Umsatz | 3.049.801 EUR | 2.783.772 EUR | 19.735.349 EUR | 762.455 EUR |
| davon einem Rezept zugeordnet | 44 % | 73 % | 52 % | 49 % |
| Ist-Wareneinsatz | −30,50 EUR | 108.567 EUR (5,36 %) | 1.605.417 EUR (15,64 %) | **−10.036.635 EUR (−2667 %)** |
| Soll-Wareneinsatz | 0 EUR | 95.663 EUR (4,72 %) | 55.331 EUR (0,54 %) | 5.873 EUR (1,56 %) |

Die Quelle wertet: „kein knapper Wert und kein Rundungsproblem, sondern offensichtlicher Unsinn" (Aposto). Bei Deutsche
Konzepte liegen die Quoten um etwa den Faktor fünf unter dem üblichen Bereich der Gastronomie. Die Oberfläche zeigt diese Werte
**ohne Warnung und ohne Hinweis**. Die Quelle führt die Ursache „mit hoher Wahrscheinlichkeit" auf D3 zurück (die Kette Verkauf,
Rezeptur, Warenverbrauch bricht vor der Rezeptur ab) — **Zusammenhang nicht bewiesen**.

**Abgrenzung.** Die niedrige Zuordnungsquote (44 bis 73 %) ist teilweise Datenpflege bei Concept Family; ein negativer
Ist-Wareneinsatz und −2667 % erklärt sie nach der Quelle nicht.

**Unser Gegenbeleg.** Die eigene Rechnung aus LINA-Verkaufsmengen und `zutat.cost` ergab für Aposto Gera, Juni 2026, 19,8 % (40
von 146 zugeordneten Rezepten) — plausibel.

**Weitere Auffälligkeit, Vorzeichen ungeklärt.** Die Summe von `totalWasteValue` im Food-Waste-Bericht ist **negativ**
(−1.276.194,18; 18. und 19.11.2026, 1.981 bzw. 1.986 Tageszeilen, markenweit). Die Quelle verlangt, das Vorzeichen zu klären,
bevor jemand die Zahl liest; ein Mangel ist damit nicht belegt.

**Stand.** Seit 27.07.2026 nicht nachgemessen (am 18./19.11.2026 nur Form und Größe der Antworten gelesen, nicht die Kennzahlen).

**Beleg.** `foodnotify-api-inventar.md`, §8a und §8b; `plan-foodnotify.md`, Stufe 0.2 und B3; `entscheidungen.md`, 01.08.2026;
`payloads/foodnotify-2026-11/fn-probe-2026-11-19-echt.md`, §3.

### D5 — Gebindeangaben derselben Ware widersprechen sich

**Beobachtet am 03.08.2026** an 310.761 Bestellpositionen. `totalUnitQuantity` entspricht in 310.032 Fällen
`menge × packagingQuantity × unitQuantity`. Bei **2.116 von 20.750 Waren** steht `packagingQuantity` aber mal auf 50 und mal auf 1
(derselbe Kaffee, dieselbe Bestellung, zwei Angaben). Dazu der Fall, in dem beide Felder zueinander passen und gegen die gleiche
Ware nicht: `packagingQuantity` 50 / `unitQuantity` 0,007 ergibt 38 EUR/kg, `packagingQuantity` 1 / `unitQuantity` 0,00035 ergibt
48.400 EUR/kg (Faktor 1.275). Die Gebindeangabe derselben Ware schwankt zwischen 0,00035 und 50 (Faktor 142.857).

**Kosten.** Die Karte „Einkaufspreise im Verlauf" zeigte 48.400 EUR/kg für Kaffee ganz oben. Wir wechselten die Kennzahl auf den
Preis **je Gebinde** (nur `sumPrice` und `adjustedQuantity`, beide sauber; Median 14,36 EUR über 310.496 Positionen) und verwerfen
den Preis je Einheit, wo die Menge unstimmig ist (414 von 876.341 Positionen, 0,05 %; Migrationen `0040`, `0042`, `0060`,
`0061`).

**Offen.** Ob der Fehler im Lieferantenkatalog oder in FoodNotifys Verarbeitung entsteht, ist nicht untersucht; die Quelle nennt
die Gebindeangabe „eine Stammdatenangabe, die der Lieferant pflegt und niemand prüft". Dass FoodNotify sie nicht prüft, ist
eine Deutung, kein gemessener Befund.

**Beleg.** `fehlerkatalog.md`, „Eine Zeile, die in sich stimmt und trotzdem falsch ist (03.08.2026)"; `migrations/0040_*.sql`,
`0042_*.sql`.

### D6 — Irreführende und verrauschte Felder an Bestellpositionen

**Beobachtet am 02.08.2026 und 03.08.2026.**

* `amount` ist in FoodNotifys echten Antworten **immer 0** (13.126 von 13.126 Positionen, keine Ausnahme); die tatsächliche Menge
  steht in `adjustedQuantity`. Das API-Inventar vom 27.07.2026 führte `amount` als Menge.
* `isSubstituted` ist in allen 13.155 Positionen `null`; unterscheidend ist `status` (`'not arrived'`).
* `adjustedQuantity` trägt Rundungsreste, wo glatt null herauskommen müsste: `4,4408920985006262e-16` statt `0`.

**Kosten.** Alle 13.027 damals geladenen Positionen trugen `einzelpreis = NULL`, bis das richtige Feld gelesen wurde. Ein
Rundungsrest riss eine ganze Bestellung (Überlauf `numeric(14,6)`) und kostete vier vollständige Bestellungen. Beides ist bei uns
behoben (aus `raw` neu gerechnet, ohne neuen Abruf).

**Einordnung.** Ob `amount` absichtlich nicht benutzt wird, ist nicht untersucht; belegt ist nur, dass das Feld seinen Namen nicht
trägt.

**Beleg.** `fehlerkatalog.md`, „Die Attrappe bildete ein plausibleres Schema nach als die echte API (02.08.2026)" und „4,44e-16 ist
keine Menge — und riss eine ganze Bestellung mit (03.08.2026)".

### D7 — Fehlende und mehrdeutige Warennummer

**Beobachtet.** Bei 55.408 von 310.761 Positionen (rund 18 %, 03.08.2026) fehlt `concreteProduct.id`; 55.232 davon tragen
`ingredient.artikelId`, die Nummer des Lieferanten. Die interne `concrete_product`-Nummer ist nicht je Ware eindeutig: derselbe
Aperol steht bei Aposto unter **zwanzig** IDs, eine je Gebinde und Shop-Zuordnung (22.08.2026); 866 Waren-IDs tragen 428 Namen
(`datenherkunft.md`).

**Umgehung.** Der Schlüssel ist die Lieferanten-Artikelnummer (`bestellposition.lieferanten_nr`, über alle vier Marken zu 99,8 %
gefüllt).

**Einordnung.** Die Quelle führt das als Eigenschaft („eine je Gebinde und Shop-Zuordnung"), nicht als Fehler; als Mangel nur
insofern, als die Warennummer nicht belastbar zur Ware führt.

**Beleg.** `migrations/0042_einkaufspreis_gebinde.sql`; `fehlerkatalog.md`, „Pflichtartikel: vier Fehler …" (22.08.2026), Punkt 1.

### D8 — Rezeptliste instabil und unvollständig

**Beobachtet 14. bis 17.09.2026** (Vollabzug Enchilada, 8.304 GET) und 15.10.2026 (Probe an allen vier Marken).

* Die Liste ist nach `createdAt` sortiert, und **760 von 2.076 Einträgen teilen den Zeitstempel** mit dem Vorgänger. An
  Seitengrenzen stehen **21 Einträge doppelt**; entsprechend fehlen vermutlich 21.
* **56 Rezepte** standen nicht in der Liste und waren nur über Verweise (Unterrezepte, Kassenzuordnung) erreichbar, alle über
  `/api/recipes/{id}` ladbar, keine 404. Mit der Seitengrenze erklärt sich das nicht (nur 9 lägen auf einer Seite mit Duplikat). Elf haben einen
  gleichnamigen Listeneintrag und sind in allen elf Fällen der ältere. Welches Kriterium sie ausblendet, ist unbekannt. Hypothese:
  archivierte Rezepte (`archived`), **nicht bewiesen**.
* `perPage` wird ignoriert; die Seitengröße ist fest bei 25.
* Die Liste ist keine Aufzählung aller Rezepte; was weder in ihr steht noch verwiesen wird, sehen wir nicht.

**Umgehung.** Volle Listenrunde wöchentlich, jede Verweis-ID einzeln nachholen (`in_liste = false`).

**Beleg.** `foodnotify-api-inventar.md`, §3 (Messungen 14.09., 15.09., 17.09.2026, Probe 15.10.2026); `offene-punkte.md`, Punkt 4a.

---

## 3. Schnittstelle

### A1 — GET-Aufrufe, die etwas verändern

**Beobachtet, 18.11.2026.** Bei FoodNotify sagt die HTTP-Methode nichts über die Wirkung. Die Oberfläche schickt Aktionen oft als
GET. Aus dem Code der beiden Oberflächen gelesen (nicht ausgeführt): **14 GET-Pfade**, die etwas verändern — Sprache und
Darstellung des Benutzers setzen, Sitzung beenden, den zuletzt benutzten Betrieb merken, **die Kassenverbindung lösen**, **alle
Produktverknüpfungen einer Kasse lösen**, den Bestand aus dem Kassensystem nachladen, eine Betriebsstätte speichern, einen
Verkauf abschließen, eine Einbettungs-URL erzeugen, einen Produktimport starten oder abbrechen, ein Produktbild löschen.
Nr. 11 (Import abbrechen) ist aus Name und Pfad geschlossen. Dazu der **fünfzehnte**, gemessen (A2).

**Zwei dieser Wirkungen sind beobachtet:**

* Das bloße **Öffnen der Seite** `/brew/erp/7984` setzte `GET /api/erp/last-used/7984` ab; das Konto führt seitdem diesen
  Betrieb als zuletzt benutzten (statt 11035). Wirkung wie ein Klick, sonst keine Änderung; kein Fehler, keine Warnung.
  `/erp` (leitet weiter) und `/dashboard` zeigen den Abruf beim ersten Laden ebenfalls in der Abrufliste.
* Das Lesen eines Warenkorbs (A2).

**Risiko.** Jeder Automat, jede Messschleife und jede Seitenabfrage, die „nur liest", kann Daten des Kunden verändern. Eine
Folgenabschätzung für Dritte (etwa ein Link, der das Löschen auslöst) steht in der Quelle nicht und ist nicht untersucht.

**Drei dieser Pfade führt das alte Inventar vom 27.07.2026 als gewöhnliche Lesepfade** (`last-used`, `pos/sync/reload`,
`generate-embedded-url`); eine Liste „zum Abrufen" hätte sie mitgerufen.

**Beleg.** `foodnotify-api-inventar-intern-2026-11.md`, §6 (Liste mit Fundstellen, Vorfall 18.11.2026); `payloads/…/messliste-token.md`,
§4; `fehlerkatalog.md`, „Ein Seitendurchgang in FoodNotify hat einen GET mit Wirkung ausgelöst (18.11.2026)";
`menue-durchgang-2026-11-18.md`, Auffälligkeit 1.

### A2 — Lesen eines Warenkorbs schreibt

**Beobachtet am 19.11.2026, 09:09 bis 09:11 UTC** (Konto Wilma Wunder, ein Entwurf eines inzwischen geschlossenen Betriebs,
Lieferant Distra, Bar Hannover). `GET /api/shop/{shopId}/cart/{type}/{cartId}` hat den Warenkorb **verändert**:

| Feld | vor dem Lesen | nach dem Lesen |
|---|---|---|
| `timeUpdated` (Warenkorb-Liste) | 01.03.2026 08:40:53 | 19.11.2026 10:09:56 (zwei Sekunden nach dem GET) |
| `deliveryDate` | nicht erfasst | 20.11.2026, frühestmöglicher Termin |
| `deliveryDateUpdated` (Antwort) | — | `true` („Lieferdatum wurde auf das Ehestmögliche verschoben") |

Von 37 Warenkörben in der Liste (Vergleich aller Felder jedes Eintrags) hat sich **genau der gelesene** verändert. Der Server
prüft beim GET den gespeicherten Liefertermin, verschiebt ihn bei Ablauf auf den frühestmöglichen und speichert das. Weder
Fehlerstatus noch Hinweis in der Antwort (außer dem Feld `deliveryDateUpdated`).

**Folge.** Die Messung wurde nach diesem einen Warenkorb **sofort abgebrochen**. Keine Bestellung, keine Positionen, keine Preise,
kein anderer Warenkorb verändert. Die Änderung ist nicht umkehrbar (Rückgängigmachen hieße schreiben). Bei einem Entwurf, den
jemand bearbeitet, wäre der Termin im offenen Warenkorb verschoben worden. Die Seite `/brew/shop/{id}/cart/…` setzt den GET und
zusätzlich `POST /info` beim Laden ab.

**Einschränkung.** Ein einziger Warenkorb, ein Lieferant, ein geschlossener Betrieb. Nicht geklärt: ob der Server nur
**abgelaufene** Termine verschiebt oder bei jedem Lesen neu setzt; der Liefertermin vor dem Lesen ist nicht erfasst.

**Beleg.** `payloads/foodnotify-2026-11/fn-probe-2026-11-19-warenkorb-verkaeufe.md`, Messung 1; `fehlerkatalog.md`, „Die Leseprobe
maß ein Testrestaurant, und der Befund „Verkaufsimport steht" ging an den Nutzer (19.11.2026)", dritter Abschnitt;
`foodnotify-api-inventar-intern-2026-11.md`, §6 Nr. 15.

### A3 — Uneinheitliche Fehlercodes; 404 für Validierung

**Beobachtet am 18.11.2026** (nur GET, ein Konto). Ein fehlender oder ungültiger Pflichtparameter wird je Endpunkt anders
beantwortet:

* **404** „Dieser Wert sollte nicht leer sein." (`erp/stock-transfer`, `erp/stock-transfer-request`, `erp/food-waste`,
  `erp/food-waste-alpha/totals`, `erp/catalog/commodity-groups`, `core/business/{id}/locations/vat-defaults`) — der Pfad existiert,
  die Validierung meldet 404.
* **422** mit gleichem Text (`erp/food-waste-alpha/recipes`, `analytics/budget/{id}`).
* **500** „Typed property … must not be accessed before initialization" (`erp/stocktakings` ohne `erpIds[]`) und PHP-Typfehler
  mit Parametername (`{erpId}/product`, `{erpId}/dashboard` u. a.), dazu `Call to a member function format() on bool`
  (`recipes/dashboard-mix/{id}?day=` ohne Datum).

**Risiko.** Wer ein 404 als „gibt es nicht" verbucht, verliert bei einem geänderten Pflichtparameter still eine Quelle. Ein 405
mit `Allow` verrät außerdem, **welche schreibenden Routen** unter einem Pfad liegen (z. B. `DELETE` an
`/api/{erpId}/shop-order/{id}`), ohne dass man sie aufruft.

**Umgehung.** Der Importer liest den Antworttext mit und verbucht ein 404 mit „Dieser Wert sollte…" nie als „gelöscht"
(18.11.2026).

**Beleg.** `foodnotify-interna-aus-fehlermeldungen.md`, §2 und §4; `fehlerkatalog.md`, „Ein 404 von FoodNotify hätte ausgesehen
wie die Löschung aller Rezepte (18.11.2026)".

### A4 — `paginate` und `search` werden als ID gelesen

**Beobachtet am 18.11.2026.** Die alte Oberfläche erbt für jede Ressource `index`, `show`, `paginate`, `search`; der Server kennt
`…/paginate` und `…/search` nur für einige. Wo sie fehlen, landet das Wort als ID im Detail-Controller:

* `stocktaking`, `preproductionConcreteProduct`, `category/search`: HTTP 500, PHP-Typfehler (`must be of type int, string given`).
* `resets`, `erp/stock-transfer`: HTTP 500 `SQLSTATE[22P02] … invalid input syntax for type integer: "paginate"` — keine
  Typprüfung vor der Datenbank; das Wort kommt als gebundener Parameter einer vorbereiteten Abfrage dort an
  (`unnamed portal parameter $1`). Eine Einschleusbarkeit ist damit **nicht** belegt.

Von 53 gemessenen geerbten Zeilen gibt es 37 für GET gar nicht (405). Eine einheitliche Regel „Liste = `/paginate`" gibt es nicht;
`category` hat `/paginate`, aber kein `/search`, `product-group` das Umgekehrte.

**Beleg.** `foodnotify-interna-aus-fehlermeldungen.md`, §3 (Tabellen 3.1 bis 3.3); `foodnotify-api-inventar-intern-2026-11.md`, §9 Nr. 3;
`messung-sitzung-2026-11-18.md`, Auffälligkeit 2.

### A5 — Pfade und Seiten ohne Funktion, uneinheitliche Kennungen

**Beobachtet.**

* **18.11.2026:** `GET /api/{erpId}/category-icon/paginate` antwortet 500 „You have requested a non-existent service
  `erp.category.icon.normalizer`" — die Route verweist auf einen Dienst, den es im Container nicht gibt. Keine Oberfläche benutzt
  den Pfad.
* **18.11.2026:** HTTP 500 **ohne** Text bei `eventCatering/eventStaffRole`, `eventCatering/roleOptionValue` und
  `{erpId}/sales/search`.
* **18.11.2026:** Eine Testseite steht in der Produktion (`/brew/erp/{erpId}/test`): erreichbar, zeigt nichts, lädt 69 KB in 4,1 s.
* **19.10.2026:** Jede Bestellung trägt drei Nummern: `id` (Pfad der API), `orderNumber` (Bestellnummer der Kostenstelle) und
  `markedShopOrder.orderId` (die Nummer, die die Oberfläche zeigt; Beispiel 638090 / 451 / 645599). Unter der `id` antwortet die
  Oberfläche mit HTTP 500 „Diese Bestellung ist nicht vorhanden". `/change/paginate/checked` liefert auch bei
  funktionierenden Bestellungen eine leere Liste.
* **18.11.2026:** `/api/pub/version` (im Bundle als GET geführt) antwortet 405.

**Beleg.** `foodnotify-interna-aus-fehlermeldungen.md`, §2 und §3.4; `menue-durchgang-2026-11-18.md`, Auffälligkeit 2;
`foodnotify-api-inventar.md`, Nachtrag 19.10.2026 zu §4; `foodnotify-http500.md`.

### A6 — Uneinheitliche Hüllen und Seitenparameter

**Beobachtet.**

* **Drei Antworthüllen** für dieselbe Familie, je nach Marke und Endpunkt (27.07.2026): `{order_by, current_page, page_count,
  total_count, data}`, `{errors, payload{…}, code, isError}`, `{data:{…}}`; die Cost-Analysis-Endpunkte liefern nackte Arrays. Ein
  falsches Auspacken meldete bei Wilma Wunder null Inventuren, tatsächlich waren es 275 — **lautlos**, HTTP 200, leeres Ergebnis.
  Auch `/api/erp/stocktakings` (13.08.2026) antwortet mit der Hülle `{data, pagination}`, nicht mit der des Pfadmusters `/api/erp/*`.
* **Vier Benennungen der Seitensteuerung in einer Oberfläche** (18.11.2026): `page_size`/`order_by`, `pageSize`, `perPage`,
  `limit`; in der öffentlichen Spezifikation fünf Varianten.
* **`perPage` an `/api/recipes` wird ignoriert** (27.07.2026).
* **`timeCreated` in zwei Formen:** serialisiertes PHP-`DateTime` (`{date, timezone_type, timezone}`) oder `{timestamp}`, neu ISO.

**Kosten.** Eine Zeile, die nach „keine Daten" aussieht; unser Importer behandelt eine 200er-Antwort mit null Zeilen deshalb als
Auffälligkeit.

**Beleg.** `foodnotify-api-inventar.md`, §1, §8b, „Korrektur 13.08.2026"; `foodnotify-interna-aus-fehlermeldungen.md`, §5;
`menue-durchgang-2026-11-18.md`, Auffälligkeit 8; `foodnotify-api-inventar-offiziell.md`, „Uneinheitliche Seitenparameter".

### A7 — Große Antworten ohne Seiten, langsame und abbrechende Abrufe

**Beobachtet.**

* `/api/pos/mapping/{connectionId}/link-targets` liefert **alle** ~13.250 Rezepte der Marke in einer Antwort, 3,06 MB, ohne
  Seitensteuerung. Dauer: 11,3 s (18.11. tagsüber im Browser), **2,0 s** (19.11., 06:12 UTC) und **zwei von zwei Läufen in die
  120-s-Grenze** (19.11., 00:48 bis 01:15, nachts).
* `/api/pos/mapping/{connectionId}/articles`: 19 bis 39 s je Antwort; je Lauf brach einer von drei Aufrufen ab (Timeout bei 120 s,
  `ECONNRESET` nach 81 s). `article-sales` 11,3 s; ein Artikelbild 9,1 s für 23 KB.
* `cost-analysis/ingredients/by-product` 1,4 MB (5.077 Zeilen), `erpSettings/restaurants/shared` 0,7 MB.
* In der Messzeit der Nacht war FoodNotify insgesamt träge: 0,8 bis 68 s je Antwort, zwei Verbindungsabbrüche.

**Einschränkung.** Ob die Nachtzeit oder die Pfade schuld sind, ist mit einer Messung nicht zu trennen (Tageswert 2 s, zwei
Nachtwerte Timeout). Die Größe von `link-targets` steht mit 3,06 MB und 551 KB verschieden da; vermutlich ausgepackt gegen
komprimiert übertragen (nicht geprüft).

**Umgehung.** Zeitgrenze 180 s (`FN_ZEITGRENZE_LANG_MS`), ein Abbruch gilt nie als „keine Artikel".

**Beleg.** `payloads/foodnotify-2026-11/fn-probe-2026-11-19.md`, §1 und „Was offen bleibt"; `…/fn-probe-2026-11-19-tag.md`, §1;
`menue-durchgang-2026-11-18.md`, Auffälligkeiten 3 und 4; `messung-sitzung-2026-11-18.md`, Auffälligkeit 8; `importer.md`, „FoodNotify: Kassenartikel → Rezept".

### A8 — Keine Änderungsdaten; verrauschte Detailantworten

**Beobachtet.**

* **Kein Änderungsfilter**: Kein Endpunkt für Bestellungen, Rezepte, Inventuren oder Waren hat einen Änderungs- oder Datumsfilter.
  Den einzigen `updated_since` führen die beiden fn-recipe-Feeds, dort laut Spezifikation `deprecated` und zugleich „Reserved —
  not yet publicly documented; subject to change".
* **Rezepte ohne Änderungsdatum und ohne Status** (15.10.2026, an allen 2.111 Dateien geprüft). Die einzige Stelle mit einem Datum
  je Rezept ist `link-targets.updatedAt` (80 Rezepte in 14 Tagen); ob es sich bei einer reinen Zutatenänderung bewegt, ist
  nicht geprüft.
* **Rauschen in der Detailantwort** (gemessen bis 25.08.2026): Von 400 Bestellungen änderten sich 322 Antworten auf Rohebene,
  **0 von 400** im Inhalt der Bestellung. Der Unterschied steckt in mitgelieferten Feldern, die nichts mit der Bestellung zu tun
  haben (`concreteProduct.stock`, `timeModified` des Artikelstamms, `productStockDetails.arrivingOrders`).

**Kosten.** Bis `0098` holte der Importer 2.960 Bestellungen je Nacht doppelt (5.920 Aufrufe), davon nachweislich 4.288 ohne
Ertrag; für Rezepte bleibt ein fester Umlauf von 14 Tagen (~1.260 Rezepte je Nacht, ~2.500 Aufrufe).

**Beleg.** `importer.md`, „FoodNotify: 2.144 der 2.960 aufgefrischten Bestellungen sind nachweislich eingefroren";
`foodnotify-api-inventar-offiziell.md`, „Datumsfilter und Änderungsfilter"; `plan-rezepturen.md`, §1; `…/fn-probe-2026-11-19-tag.md`, §1.

### A9 — Die öffentliche API ist nicht nutzbar; Positionen und Inventuren nur über die interne Schnittstelle

**Gemessen am 18.11.2026** (Konto Wilma Wunder, Scope-Token, nur GET, je Pfad ein Aufruf; 189 Pfade).

* **`full-access` ist nicht anlegbar.** Die Oberfläche kennt den Scope, bietet aber nur die 22 Scopes aus `grantable-scopes` an.
* **Jeder gemessene `/api/1.0/…`-Pfad** weist das Scope-Token ab: 403 „This endpoint does not support scope-limited tokens."
  (insgesamt 93 von 189 gemessenen Pfaden mit dieser Meldung, darunter `/api/erp/all`, `/api/pos/locations`, `/api/erp/stocktakings`,
  `/api/profile`, alle drei `/api/2.0/erp/stock/*`). Die Familie 1.0 wurde vorab als Ganzes geprüft, nicht jeder Pfad einzeln.
* **Mit dem Token antworten 41 Pfade, mit der Cookie-Sitzung 129 von 204** (Größenordnung; Zeilen nicht verglichen).
* **Bestellpositionen** (`/change`) und **Inventuren** (Liste, Kopf, Positionen) gehen **nur mit der Sitzung**. `markedShopOrder.products[]`
  im Bestellkopf trägt nur `price` und `productId` und ersetzt `/change` nicht. Mit Token fehlen außerdem `/api/profile`
  (Benutzer-ID) und `/api/pos/locations` (Anbindungsliste).
* Die fn-recipe-Feeds der Spezifikation antworten 500 „Account is not of type FnRecipe".
* **Sechs der 14 Pfade des Importers stehen in keinem der beiden Oberflächen-Bundles** (die vier Rezeptpfade, die Inventurpositionen,
  die Bestellansicht). Wer sie ruft, ist nicht erhoben. Braucht die Oberfläche sie nicht mehr, kann FoodNotify sie ohne
  Ankündigung abschalten.

**Hypothese, nicht belegt:** Die abgewiesenen Pfade verlangen ein `full-access`-Token. Wer es ausstellen kann (FoodNotify, ein
anderes Konto, eine Lizenz), ist unbekannt.

**Risiko.** Wer Einkauf oder Inventur automatisiert lesen will, ist auf die interne, undokumentierte Schnittstelle mit
Browser-Sitzung angewiesen; eine öffentliche API, die dafür reicht, gibt es nach unseren Messungen nicht. Das ist ein
Betriebsrisiko ohne Zusage von FoodNotify.

**Beleg.** `foodnotify-api-inventar-offiziell.md`, „Messung mit Token", „Was geht, was abgewiesen wird", „Endstand"; `foodnotify-api-inventar-intern-2026-11.md`,
§8 (sechs Pfade); `payloads/…/messung-sitzung-2026-11-18.md`.

### A10 — Die OpenAPI-Spezifikation ist unvollständig und widersprüchlich

**Beobachtet am 18.11.2026** (neun JSON-Dateien von der öffentlichen Dokumentationsseite, nur gelesen).

* `securitySchemes` fehlt in **allen neun** Dateien, obwohl überall `security: Bearer` steht; Tokenart, Ausstellung und Laufzeit sind
  nicht beschrieben. Nur ein Scope (`pos:read`), nur in drei 403-Beschreibungen.
* Antwortfelder nur in 2 von 9 Dateien (`2.0_pos`, `2.0_erp`); in Recipe, Shop, User, Erp.Legacy, Webhooks und Catering hat jede
  Operation nur eine leere `default`-Antwort ohne Schema.
* Keine Rate Limits, keine 429-Antwort, keine Retry-Hinweise.
* `SupplierResource.identifier` ist `boolean` und Pflichtfeld (vermutlich Generatorfehler).
* Zwei Generatoren (`operationId` in 1.0 und 2.0 verschieden), Doppelgänger-Schemas mit angehängter 2; Schema `InventoryFilterQuery`
  (klingt nach Inventur) gehört zu den fn-recipe-Feeds; Pfade außerhalb ihres Bereichs; Datumstypen uneinheitlich; Emoji in
  Summaries; keine Beispiele in 1.0; keine Abkündigung von 1.0 erkennbar.
* Die Indexseite führt als Fußzeile „Powered by Agents. Fixed and polished by Humans".
* Der Weg zu den Pfad-IDs ist nicht erklärt (`accountIdentifier`: es ist die `connectionId`, von uns gemessen).

**Beleg.** `foodnotify-api-inventar-offiziell.md`, „Was die Spezifikation nicht sagt" und „Kopf".

### A11 — Lieferkonditionen nur über den schreibenden Warenkorb-GET lesbar

**Beobachtet am 19.11.2026** (Bundle-Analyse, eine Messung). Mindestbestellwert (`minimalOrderSum`), Liefertage
(`deliveryDates[]`, `unavailableDeliveryDates[]`) und Bestellfrist je Artikel (`preorderDays`) stehen **nur** am Warenkorb-GET —
demselben, der beim Lesen schreibt (A2). Ein Bestellschluss ist kein Feld; er ist in die Terminliste eingerechnet. Für **vier
Lieferanten** (Shop-IDs 9243, 8014, 8522, 130036) stehen Bestellschluss (10:00 bzw. 8:00 Uhr) und eine Teilbarkeitsregel (durch
6) **fest im Oberflächencode**, nicht in einer Antwort. Der **kundenspezifische Tourenplan** hat in keinem Bundle einen Lesepfad für
Kunden; er liegt serverseitig. Der Mindestbestellwert ist eine Warnung, keine Sperre (Text der Oberfläche).

**Gemessen an einem Warenkorb** (Distra, Bar Hannover): Mindestbestellwert 0 EUR, wählbare Termine Montag bis Samstag; dieselbe
Kostenstelle bestellte seit September 2025 nur mittwochs. Die Termine sind der Spielraum, nicht der Tourenplan.

**Beleg.** `payloads/foodnotify-2026-11/lieferkonditionen-bundle-2026-11-19.md`; `…/fn-probe-2026-11-19-warenkorb-verkaeufe.md`.

### A12 — MCP-Server: Beschreibung, Berechtigungen und Anleitung passen nicht zusammen

**Beobachtet am 18.11.2026** (öffentliche Seiten und OAuth-Metadaten, ohne Anmeldung).

* Die Werbeseite sagt „Ändern kann er nur Rezepte"; die Metadaten führen den Scope `erp-product:write` (Produkte im
  Warenwirtschaftsteil). Was dieser Scope ändert, ist unbekannt.
* Es gibt **keine Anleitung zum Verbinden** (alle 333 Adressen der Hilfe-Sitemap durchgesehen: kein Artikel zu MCP, KI-Assistent,
  Claude, ChatGPT oder Connector) und **keine veröffentlichte Werkzeugliste**; die Werkzeugnamen stehen nur in einer
  Werbeanimation.
* Der Server bietet keine dynamische Client-Registrierung, nur URL-basierte Client-Kennungen; ob die genannten Anbieter ohne
  dynamische Registrierung anmelden, ist nicht belegt. FoodNotify behauptet öffentlich, dass es mit Claude und ChatGPT läuft.
* Auf `api3` und `connect` antwortete derselbe Pfad zuerst 403 „Forbidden: Invalid Host header." und später 401; Ursache der
  Abweichung offen.
* Der Server hängt an einer Person und deckt nach seinen Scopes weder Einkauf noch Inventur noch Verkäufe ab.

**Beleg.** `foodnotify-mcp-server.md`, §2, §3.3, §4 und §6.

---

## 4. Sicherheit und Datenschutz

Zuerst die Abgrenzung: **Keiner der folgenden Punkte ist als ausgenutzte oder ausnutzbare Schwachstelle belegt.** Es wurde nicht
nach Schwachstellen gesucht, nur gesammelt, was bei gewöhnlichen Leseaufrufen von selbst zurückkam oder im ausgelieferten Code steht.
Eine datenschutzrechtliche Bewertung (Auftragsverarbeitung, Drittlandübermittlung) ist **nicht** vorgenommen.

### S1 — Fehlermeldungen geben Interna preis

**Beobachtet.**

* **18.11.2026** (HTTP 500 und andere, auch mit dem Token gesehen): Klassennamen und Dateipfade mit Zeilennummern
  (`/var/www/src/ErpBundle/…`, `…/http-kernel/HttpKernel.php on line 183`), `SQLSTATE`-Fehler im Klartext
  (`SQLSTATE[22P02]`, am 27.07.2026 `SQLSTATE[42703] … t0.root_recipe_id`), Namen fehlender Dienste im Container, PHP-Fehler.
  Daraus lassen sich Aufbau (Symfony, Doctrine, PostgreSQL, Installationspfad `/var/www`), zwei Code-Generationen nebeneinander und die
  Namen interner Klassen ablesen. Die Antwortköpfe von `api3` nennen Webserver und PHP-Version (`server`, `x-powered-by`).
* **27.07.2026:** ein 405 lieferte den **vollständigen Symfony-Stacktrace** mit absoluten Serverpfaden und Release-Zeitstempel
  („Kein Loch, aber unnötig", so die Quelle). Am 18.11.2026 kamen bei 405 nur noch die Routenmeldungen, keine Traces.
* Validierungsfehler kommen deutsch, die Sprache folgt dem Konto, nicht dem `Accept-Language`.
* Die Meldungen verraten, **welcher Parameter fehlt und welche Route gegriffen hat** — das hilft jedem, der den Weg erkundet.

**Einordnung.** Die Quelle bewertet das nicht als Schwachstelle, sondern als „ungewöhnlich gesprächig". Ob die Server-
Fehlermeldungen im Produktionsbetrieb absichtlich ausführlich gelassen sind, ist nicht bekannt.

**Beleg.** `foodnotify-interna-aus-fehlermeldungen.md`, §1 und §2 (Meldungen wörtlich in `payloads/foodnotify-2026-11/fehlermeldungen-2026-11-18.csv`);
`foodnotify-api-inventar.md`, §11; `messung-sitzung-2026-11-18.md`, Auffälligkeit 1.

### S2 — Interne Objektfelder und Metaspalten in Antworten

**Beobachtet am 18.11.2026.** In der Antwort von `/api/{erpId}/statistics/sales` und `…/shop-orders` steht das Feld
`"\u0000Carbon\CarbonTimeZone\u0000clock"` — ein privates Objektfeld, das beim Serialisieren herausgefallen ist. Die Antwort von
`/api/erp/stocktakings/validation/{erpId}` führt interne Metaspalten (`dbMetaTimeCreated`, `dbMetaTimeUpdated`) durch.

**Beleg.** `foodnotify-interna-aus-fehlermeldungen.md`, §1 (Tabelle, „Datumsbibliothek") und §5.

### S3 — Sitzungsaufzeichnung ohne Textmaskierung und Namensübermittlung (alte Oberfläche `/panel`)

**Aus dem Code gelesen am 18.11.2026** (Bundle `main` der alten Oberfläche; nicht ausgeführt, die Aufzeichnung selbst nicht
beobachtet).

* **Sentry** mit Sitzungsaufzeichnung: `replaysSessionSampleRate` 0,1 (10 % aller Sitzungen), `replaysOnErrorSampleRate` 1 (100 % bei
  Fehlern), Replay-Integration mit `maskAllText: false` und `blockAllMedia: false`. Nur in `production`. Ziel ist ein Endpunkt bei
  `ingest.us.sentry.io`. Nach der Quelle gehen Bildschirminhalte **unmaskiert** an einen US-Endpunkt.
* **Gleap** (Rückmelde- und Tracking-Werkzeug): `main` ruft nach jeder Anmeldung `Gleap.identify(<Benutzer-Id>, {email, name})`;
  Ereignisse aus Lieferantenseite, Warenkorb und Smartlisten. Aktiv, kein totes SDK.
* In der neuen Oberfläche `/brew` wurde kein Sentry und kein Gleap gefunden (Suche über alle 340 Dateien, 18.11.2026); beim Öffnen
  von 68 Seiten der neuen Oberfläche keine Abrufe dorthin.

**Folge.** Wer in der alten Oberfläche arbeitet, wird (stichprobenweise, bei Fehlern immer) aufgezeichnet und namentlich an einen
Drittdienst gemeldet; angezeigt werden dort auch Betriebsdaten, Preise und Namen von Mitarbeitenden. Ob FoodNotify Kunden darüber
informiert oder eine Auftragsverarbeitung geschlossen hat, ist nicht geprüft.

**Beleg.** `foodnotify-api-inventar-intern-2026-11.md`, §4 und Kurzfassung; `payloads/…/intern/panel-auth.md`, §8.

### S4 — Klartext-Passwort im Browserspeicher (Lieferantenportal)

**Aus dem Code gelesen am 18.11.2026** (Chunk `488` der alten Oberfläche; nicht ausgeführt). Die Funktion `rememberMeFun()` schreibt bei
„Angemeldet bleiben" **E-Mail und Passwort im Klartext** in den `localStorage` des Browsers (`foodnotify.email`,
`foodnotify.password`, je als JSON-Zeichenkette). Die Quelle: betrifft **nur das Lieferantenportal**, nicht die Zugänge der Marken.
Wie viele Lieferanten es nutzen und ob die Funktion im Betrieb erreichbar ist, ist nicht gemessen.

**Beleg.** `foodnotify-api-inventar-intern-2026-11.md`, §3 („Alte Oberfläche"); `payloads/…/intern/panel-auth.md`, §5.

### S5 — Browserschlüssel im Klartext

**Gelesen am 18.11.2026.** Im Bundle der neuen Oberfläche steht der Google-Maps-Browserschlüssel (`VITE_GOOGLE_MAPS_API_KEY`) als Wert
(39 Zeichen); im HTML der alten Oberfläche (`_panel_.html`, `_panel_catering.html`) steht er in der Skript-URL. **Ob er auf
Referrer beschränkt ist, ist offen.** Browserschlüssel gehören ihrer Art nach in den Client; ein Mangel besteht nur, wenn die
Beschränkung fehlt. Der Sentry-DSN und der Gleap-Projektschlüssel stehen ebenfalls im Client (laut Quelle „bewusst"). Die Werte
stehen hier nicht — Fundstellen unten.

**Beleg.** `payloads/…/intern/brew-auth.md`, §5 („Browser-Schlüssel im Bundle"); `intern/panel-auth.md`, §8.

### Hinweise (Auffälligkeiten ohne belegten Mangel)

**S6 — Verwaltung ist für das Kundenkonto geroutet, nicht verborgen.** Vier Pfade
(`v2/analytics/management/groups`, `v2/billing/management/providers`, `v2/erp/catalog-sync/management/syncs`,
`supplier/onboardings/reminder-default`) antworten einem Kundenkonto mit **403** „The user doesn't have ROLE_ADMIN" statt 404 —
der Server prüft also; es gibt sie, und sie sind auffindbar. Fünf `/brew/admin/*`-Seiten leiten auf `/analytics` oder bleiben leer.
Eine Umleitung warf über 50-mal „Minified React error #185"; das kann am Seitenwechsel per `pushState` liegen und ist **nicht** als
Fehler der Oberfläche belegt. Ob der Server überall dieselben Rechte erzwingt wie der Client (Guards), sagt der Code nicht.
*Beleg:* `messung-sitzung-2026-11-18.md`, Auffälligkeit 5; `menue-durchgang-2026-11-18.md`, Auffälligkeit 6; `intern/panel-auth.md`, §4 und §9.

**S7 — Personenbezogene Daten in Lesepfaden.** `createdByUser`/`updatedByUser` mit Vor- und Nachname an Bestellungen und
Positionen, `signature.signer.name` an Inventuren, `subusers` mit Name, E-Mail und 2FA-Status, `company` mit Ansprechperson. Das ist
der gewöhnliche Inhalt der Konten, kein Mangel von FoodNotify; es betrifft **unsere** Datenhaltung (in `raw` und `core` ja, nie in
`mart`). Beim Öffnen der Betriebsseite geht die Adresse des Betriebs als Suchtext an Google (Geocoding), und `cdn.jsdelivr.net`
liefert einen WebAssembly-Baustein. *Beleg:* `messung-sitzung-2026-11-18.md`, Auffälligkeit 9; `menue-durchgang-2026-11-18.md`,
Auffälligkeit 5.

**S8 — Zwei Wege zu Tableau.** `/api/analytics` (alt) gibt ein `ticket` samt `siteId` heraus (Trusted-Ticket-Verfahren),
`/api/v2/analytics` (neu) nur Host und Ansichten, das JWT (Laufzeit 9 Minuten, Scope `tableau:views:embed`) kommt aus
`/api/v2/analytics/token`. Das Ticket ist ein kurzlebiges Zugangsmerkmal; wir legen die Antworten nicht ab. Der Tableau-Weg ist
ein Zugriff auf Analytics-Ansichten, nicht auf Daten. Ein Mangel ist nicht belegt. *Beleg:* `messung-sitzung-2026-11-18.md`,
Auffälligkeit 7; `foodnotify-api-inventar.md`, §7; `intern/panel-auth.md`, §7.

**S9 — Anmeldung als Kunde; Zwei-Faktor.** Administratoren mit `IS_IMPERSONATOR` können sich als Kunde anmelden (Link
`/recipes?_switch_user={email}`). Die alte Oberfläche kennt in ihrem Code **keine** Zwei-Faktor-Anmeldung (die neue: TOTP und
E-Mail); ob der Server für die alte Anmeldung (`POST /signin_check`) einen zweiten Faktor erzwingt, ist **nicht geprüft**. Beides
ist Funktionsumfang, kein belegter Mangel. *Beleg:* `intern/brew-auth.md`, §3; `intern/panel-auth.md`, §3 und §6.

---

## 5. Was wir NICHT vorwerfen können

Dies sind Befunde, die in einer Quelle stehen oder standen, aber **nicht** FoodNotifys belegter Mangel sind: eigene Fehler,
widerlegte Befunde, Vermutungen, Einzelstichproben. **Nicht vorbringen**, solange nichts Neues gemessen ist.

| Nr. | Was in der Quelle steht | Warum es nicht trägt | Quelle |
|---|---|---|---|
| N1 | „Der Verkaufsimport steht seit 31.08.2026" | **Widerlegt am 19.11.2026.** Gemessen wurde das Testrestaurant (Kostenstellen 11035 und 12066, „AAA Testrestaurant Wilma Wunder"), in dem nicht verkauft wird. An der echten Kostenstelle 7984 läuft der Verkaufsimport (21.362 Verkäufe, die jüngsten vom 18.11.2026). **Nicht vorbringen.** Der Fehler lag in unserer Probe (sie wählte die ersten Kostenstellen aus der Liste) | `fehlerkatalog.md` (19.11.2026); `payloads/…/fn-probe-2026-11-19.md`, Korrektur |
| N2 | Warenstamm-Füllgrade der Probe (`pricePerUnit` immer `null`, `packagingUnit(s)` immer `null`, `isOrderable` überall `false`, `timeModified` meist 2024), Food-Waste-Listen leer | Gelten für das Testrestaurant, nicht für eine echte Kostenstelle. Echte Werte (7984): `pricePerUnit` bei 52,9 %, `isOrderable` bei 110 von 206, `timeModified` August bis November 2026 | `fn-probe-2026-11-19.md`, §3; `fn-probe-2026-11-19-echt.md`, §1 |
| N3 | Der Liefertag in `core.bestellung.geliefert_am` stand bei 50.014 von 50.050 Bestellungen einen Tag zu früh | **Unser Fehler:** der Lader schnitt den UTC-Tag ab. FoodNotify liefert `deliveryDate` als Unix-Sekunden der Berliner Mitternacht, das ist ein zulässiges Format | `fehlerkatalog.md` (19.11.2026) |
| N4 | Jede Inventur endete bei genau 800 Positionen (neun Inventuren, 936 Positionen fehlten) | **Unser Fehler:** der Pfad ist paginiert und sagt es (`perPage` 800, `totalPages`); unser Lader kannte `page` nicht. Behoben | `fehlerkatalog.md`, „Jede Inventur endete bei genau 800 Positionen"; `foodnotify-api-inventar.md`, „Korrektur 13.08.2026" |
| N5 | Der Sollbestand der Inventuren sei „aufgebläht" (971.750 g Pizzateig gegen 138.000 g gezählt; Soll je Gezählt 0,96 bis 2,69); 28,7 % der Inventurpositionen ohne gezählte Menge; 61 von 358 Inventuren mit „Test" im Namen | Die Quelle nennt es ein „FoodNotify-Datenproblem" **unter der Bedingung**, dass der Verbrauch nicht gegen den Bestand gebucht wird. Ob die Ursache FoodNotify, die Verbuchungspraxis der Betriebe oder D3 ist, ist nicht untersucht. Testinventuren und fehlende Zählmengen sind Praxis der Betriebe | `befunde-datenlage.md`, „Der Schwund war nicht zu hoch, sondern unbrauchbar" |
| N6 | Bar und Küche desselben Betriebs tragen dieselben Bons (998 von 999 gleiche Verkaufszeiten, 933 mit gleicher Summe); jeder vierte Verkauf am Ballplatz ist ein negativer Gegenbon (273 und 271 von 1.000, Karlsruhe 0) | **Eine** Marke, **ein** Betrieb für die Doppelung (Ballplatz Mainz), drei Kostenstellen. Die Quelle führt es als Falle für den Import („Summen verdoppeln"), nicht als Fehler von FoodNotify: beide Kostenstellen hängen an **einer** Kassenanbindung. Gegenbons sind Eigenschaft der Kassendaten. Kein Mangel belegt | `fn-probe-2026-11-19-warenkorb-verkaeufe.md`, Messung 2 |
| N7 | `cost` einer Zutat sei nicht aus Unterrezepten nachrechenbar; `meta.weight.loss` (0 bei 1.163 Rezepten, 100 bei 476, sonst „krumm"); `kind = product_group` mit „(EN)" im Namen | **Bedeutung ungeklärt** — eine Wissenslücke bei uns, kein belegter Fehler. Wir übernehmen FoodNotifys Wert und deuten ihn nicht | `foodnotify-api-inventar.md`, §3; `offene-punkte.md`, Rezepturen Punkt 7 |
| N8 | Die Cost-Analysis-Endpunkte ignorierten `from/to` und `dateFrom/dateTo` | „Entweder erwartet die Schnittstelle andere Namen, oder der Zeitraum kommt aus einer gespeicherten Auswahl." Nicht geklärt | `foodnotify-api-inventar.md`, §2 und §10 Punkt 2 |
| N9 | HTTP 403 auf Kostenstelle 11805 bei laufender Anmeldung (03.08.2026), „Betriebe, die uns nicht gehören" | Ein Messpunkt; die Deutung „fremde Kostenstelle im selben Mandanten" ist unsere. Ob es ein Rechte- oder ein Datenproblem ist, ist nicht belegt | `fehlerkatalog.md` (03.08.2026), „Ein 403 auf einer Kostenstelle …"; `importer.md` |
| N10 | Niedrige Zuordnungsquoten der Kostenanalyse (44 bis 73 % des Umsatzes einem Rezept zugeordnet); nur 146 von 1.283 POS-Artikeln in Gera mit Rezept; 4 von 27 Aposto-Kostenstellen mit Kasse | **Datenpflege bei Concept Family**, nicht Mangel von FoodNotify (so auch die Quelle) | `foodnotify-api-inventar.md`, §8b; `foodnotify-0-1-nummernraum.md` |
| N11 | Rezeptnamen sind nicht eindeutig (300203 bei Wilma Wunder: 26 Rezepte unter drei Namen); derselbe Lieferant in vier Schreibweisen je Mandant; alle 29 Betriebe (Enchilada) auf `Europe/Vienna`; Kostenstellennamen mit Leerzeichen oder typografischem Apostroph | Eigenheiten der Datenpflege und der Mandantenstruktur. Die Zeitzone ist laut Quelle folgenlos (gleicher Offset wie Berlin) | `befunde-datenlage.md`; `foodnotify-api-inventar.md`, §6; `plan-foodnotify.md`, §3.1 |
| N12 | „Kein 429, keine Rate-Limit-Header" bei rund 230 Aufrufen im Abstand von 1,2 bis 1,5 s | Beobachtung, **keine Zusage** und keine gemessene Grenze. Wir halten das Anfragetempo trotzdem niedrig | `foodnotify-api-inventar-offiziell.md`, „Drosselung" |
| N13 | Aussage von FoodNotify (weitergegeben): „Für alle Kassen- und Partnersysteme bieten wir eine dokumentierte Standard-Schnittstelle an – unsere POS-API 2.0." und eine rund eineinhalb Jahre alte interne Mail, die POS 1.0 als nicht verwendet und ungetestet beschreibt | Die erste Aussage ist wörtlich weitergegeben, die zweite nur sinngemäß aus zweiter Hand; Herkunft und Aktualität sind **unbestätigt**, nach Einschätzung vermutlich überholt. Betrifft die Kassenseite, nicht Einkauf, Inventur, Rezepte. **Nicht als Beleg verwenden** | `foodnotify-api-inventar-offiziell.md`, „Was FoodNotify selbst über die Schnittstellen sagt" |
| N14 | `link-targets`: Bedeutung von `restaurantId` (Eigentümer oder Verwendung) und `updatedAt` | Ungeklärt, nicht geprüft; kein Mangel | `foodnotify-api-inventar-offiziell.md`, „Was an den Antworten auffällt" |

**Grenzen aller Befunde dieser Datei (zur Erinnerung):** Nur Wilma Wunder wurde mit Token und Sitzung gemessen (18.11.2026); die
drei anderen Marken sind nicht gemessen. Nur GET. Je Pfad meist ein Aufruf. Werte wurden in den Sitzungsmessungen nicht gelesen —
keine Aussage darüber, ob Zahlen stimmen, außer wo ausdrücklich gemessen.

---

## 6. Quellen

| Quelle | Inhalt |
|---|---|
| `foodnotify-http500.md` | D1, D2: Messprotokoll 04.08.2026, Nachträge 01.09., 10.09., 15.10., 19.10.2026 |
| `foodnotify-api-inventar.md` | D3, D4, D8, A6: Inventar vom 27.07.2026 mit Nachträgen |
| `foodnotify-api-inventar-intern-2026-11.md` | A1, A7, S3, S4: interne Schnittstelle, Sicherheitsliste, Drittdienste, technische Auffälligkeiten |
| `foodnotify-api-inventar-offiziell.md` | A8, A9, A10: öffentliche API, Token, Spezifikation |
| `foodnotify-interna-aus-fehlermeldungen.md` | A3, A4, A5, S1, S2: Fehlertexte und Aufbau |
| `foodnotify-mcp-server.md` | A12 |
| `foodnotify-0-1-nummernraum.md`, `plan-foodnotify.md`, `plan-rezepturen.md` | Rahmen, Abgrenzung (N10) |
| `payloads/foodnotify-2026-11/messung-sitzung-2026-11-18.md`, `menue-durchgang-2026-11-18.md` | Sitzungsmessung und Menü-Durchgang vom 18.11.2026 |
| `payloads/foodnotify-2026-11/fn-probe-2026-11-19*.md`, `lieferkonditionen-bundle-2026-11-19.md` | Leseproben und Bundle-Analyse vom 19.11.2026 (A2, A7, A11, N1, N2, N6) |
| `payloads/foodnotify-2026-11/intern/panel-auth.md`, `brew-auth.md` | S3 bis S5, S9 |
| `fehlerkatalog.md`, `befunde-datenlage.md`, `entscheidungen.md`, `offene-punkte.md`, `importer.md` | D2, D5 bis D7, A8, N3 bis N5, N9 |
| `migrations/0040`, `0042`, `0060`, `0061`, `0135` (Kommentare) | D1, D5, D7 |
