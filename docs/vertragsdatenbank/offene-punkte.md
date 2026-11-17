# Offene Punkte

Stand 17.11.2026. Was hier steht, ist nicht entschieden und darf nirgends als entschieden
erscheinen. Geklärte Punkte werden durchgestrichen, nicht gelöscht, mit Datum und Antwort.

## Fachlich

| Frage | bei wem | Stand |
|---|---|---|
| Staffel: gilt der niedrigere Satz im Monat des Überschreitens für den ganzen Monat, erst ab dem Folgemonat, oder rückwirkend fürs ganze Jahr (Gutschrift)? | Andreas | Am 04.11.2026 gefragt, auch nach einem Ausgleich zum Jahresende. Antwort 11.11.2026: Kalenderjahr, niedrigerer Satz für den gesamten Umsatz ab Erreichen der Schwelle. Der Zeitpunkt ist damit nicht beantwortet. **Am 17.11.2026 nachgefragt** (a ganzer Monat / b ab Folgemonat / c rückwirkend mit Gutschrift). Bis dahin wird keine Variante gebaut |
| Darlehen: Zins, Tilgungsplan; werden die offenen Posten in DATEV dabei ausgeglichen? | Andreas / Kristina | Am 11.11.2026 nur geklärt, dass „DL" Darlehen heißt. **Am 17.11.2026 gefragt** |
| Liste der „ca. 70 Betriebe" — Analytics zählt 56 bis 60 | Andreas | **Am 17.11.2026 angefordert** |
| Differenz Freudenstadt Januar 2026 (1.641,14 €) | Kristina | Am 11.11.2026 von Andreas an Kristina weitergegeben, keine Antwort in den Mails |
| Sonderregeln Außer Haus / Lieferdienst bei der Bemessung | Kristina | Am 11.11.2026 von Andreas an Kristina weitergegeben. Hängt mit Freudenstadt zusammen (1.168,29 € Außer Haus) |
| Liegen alle Verträge und Nachträge in der LINA-Ladenakte, oder nur im SharePoint? | Kristina | Am 11.11.2026 von Andreas an Kristina weitergegeben („Können wir sicherstellen, dass in LINA alles in der Ladenakte gepflegt ist?") |
| Woher nimmt Finance künftig den Umsatz für Betriebe, die bisher aus Sell & Pick kamen (Bremen)? Vorschlag: aus Analytics | Andreas | Sell & Pick ist gekündigt, Finance hat keinen Zugriff mehr (Eugene, 17.11.2026). Vorschlag noch nicht an Finance gegangen — in den Mails bis 11.11.2026 nicht enthalten |
| DATEV: Exportformat der offenen Posten, Lesezugang | Andreas / Steuerberater | 11.11.2026: Export wird geprüft; Lesezugang klärt Andreas, wartet auf Rückruf des Steuerberaters |
| Bankumsätze: Export oder Schnittstelle | Finance | 11.11.2026: „in Klärung". Entfällt als eigener Abgleich, wenn DATEV den Ausgleich führt |
| Lesende je Marke: wer genau | Andreas mit Daniel | 11.11.2026: Vorstand, Aufsichtsrat, Finance, „ggf." Geschäftsführer der Management-GmbHs für ihre Marken; Details mit Daniel abzustimmen |
| Bayreuth Januar 2026: 19,97 € zwischen Rechnung und BWA | klärt sich im Abgleich | Andreas vermutet am 11.11.2026 einen Zahlendreher beim Betrieb. Wird in Schritt 3 sichtbar |

## Technisch (Eugene entscheidet)

Optionen und Begründung in `architektur.md`, Abschnitt 5. Die Empfehlungen sind nicht entschieden.

| Frage | bei wem | Stand |
|---|---|---|
| Wo läuft die neue Datenbank: eigene Postgres-Instanz in Dokploy auf demselben Server oder eigener Server? | Eugene | offen. Empfehlung: eigene Instanz, eigener Backup-Lauf |
| Wie kommt der Umsatz herüber: eigene Leserolle in Analytics, beschränkt auf wenige `mart`-Sichten, oder nächtlicher Abzug? | Eugene | offen. Empfehlung: nächtlicher Abzug — keine Laufzeitabhängigkeit, festgehaltener Umsatzstand je Gebührenrechnung |
| Eingabeoberfläche: Technik, Anmeldung, Vier-Augen-Freigabe, Änderungsprotokoll | Eugene | offen, keine Empfehlung. Erst Schritt 4 |
| Rechte je Marke im neuen MCP | Eugene | offen. Empfehlung: Row-Level-Security in der Datenbank, nicht im Prüfer |
| Eigenes Repo oder Unterordner hier | Eugene | offen, keine Empfehlung |

## Beim Schreiben dieser Doku aufgefallen (17.11.2026)

Nicht Teil der Vorgabe. Spätestens vor Schritt 3 zu klären; wer es klärt, ist noch nicht zugeordnet.

| Frage | Woher |
|---|---|
| ~~Welche Konditionszeile gilt, wenn zwei auf denselben Monat passen?~~ Festgelegt 17.11.2026 (Eugene): Zeiträume überschneiden sich nicht, Einheit geht vor „alle Einheiten" | `datenmodell.md` |
| Was gilt bei einem Konditionswechsel innerhalb eines Monats? | Die vier Beispiele wechseln nur an Monatsgrenzen |
| Zählt der Jahresumsatz einer Staffel je Vertrag oder je Einheit? Und wie greift eine Staffel, wenn im selben Zeitraum eine Reduzierung gilt? | Staffeln und Konditionen sind getrennte Tabellen |
| Woher kommt in Schritt 3 der „von Finance berechnete" Betrag — Gebührenblatt, Rechnungen oder DATEV? | Die Vorgabe nennt die Spalte, nicht die Quelle |
| Aalen Januar 2026: Gebührenblatt 3.789,31 €, BWA 0 €. Der Aufhebungsvertrag zum 31.07.2026 erklärt den Januar nicht | `architektur.md`, Abschnitt 4 |
