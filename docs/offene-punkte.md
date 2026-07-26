# Offene Punkte

## Blockierend für den ersten echten Lauf

*(nichts mehr — der Login war der letzte Punkt hier und ist geklärt)*

### Erledigt: Login-Flow

Der erste echte Lauf scheiterte mit `Login 200, Probe 302`. Ursache waren drei falsche Annahmen, die aus dem sichtbaren Formular abgeleitet waren; `/js/common/login.js` sagt es anders: POST geht auf `/common/index/dologin`, das Passwort als **MD5-Hex**, und ein per Aufruf neu vergebenes **`secret`** aus der Loginseite muss mit. Umgesetzt in `src/lina/auth.ts`, nachgebildet in `src/lina/mock.ts`, abgedeckt in `src/lina/auth.test.ts`. Details in `docs/importer.md`, Abschnitt „Session".

Damit ist der Ablauf gegen die Attrappe grün, **gegen das echte LINA aber noch nicht gelaufen**. Beim ersten Versuch gilt: `MAX_POSTEN_PRO_LAUF=1`, und bei einem Fehlschlag **nicht wiederholen**, sondern die Meldung lesen — sie nennt die Prüfreihenfolge. Wiederholte Fehlanmeldungen sind der schnellste Weg zu einer Kontosperre.

## Rohdaten, die noch zu holen sind

Am 25.07.2026 im Browser geprüft — Einzelheiten in `docs/lina-api-inventar-1c.md`.

**Erledigt und entschieden:**
- Konzeptzuordnung ist **1:n**, verifiziert: 131 Betriebe, 0 in mehr als einer Gruppe.
- Berichte **107, 118, 23, 8, 7, 9, 24 sind gesperrt** — HTTP 500 auch auf Betriebsebene, während 97 und 114 für denselben Betrieb JSON liefern. `getReport:107` wieder auf `aktiv: false`.
- **Rezepturen gibt es nicht als JSON.** Nur HTML je Artikel, ~12 GB für alle. Nicht verfolgen.

**Noch zu bauen — hoher Wert, minimale Kosten:**
- `wawi/rezept/articleApi?franchise=1` — **Sortimentshierarchie je Artikel** (8 Groß-, 329 MEC-, 278 Detailkategorien für 9.132 Artikel). Ein Aufruf. Ohne sie bleibt der Artikelverkaufsbericht eine Liste von Nummern.
- `wawi/api/items` + `suppliers` + `units` — **Einkaufspreise je Lieferant**. `prices[].updated` zeigt nur die letzte Änderung, es gibt **keine Historie**. Monatliche Momentaufnahmen ab jetzt; rückwirkend nicht nachholbar. Das ist die Voraussetzung für jede Margenbetrachtung über die Zeit.
- 334 Feinsparten aus `analyticsFilterOptions` als Dimension.

**Für Concept Family zu klären:**
- Rechte für Bericht **107 (Gearbeitete Stunden)** und **118 (Wareneinsatz und Deckungsbeitrag)**. Ohne sie sind LINAs Effektivitäten nicht nachrechenbar und die Mitarbeiterstunden nicht zugänglich.
- Wie sich der **Betriebskontext für WAWI und Dienstplan** umschalten lässt — sonst bleiben Einkaufspreise, Bestellungen und Dienstpläne auf die Zentrale beschränkt.

## Stammdaten-Momentaufnahmen (seit 26.07.2026 im Betrieb)

Sieben Endpunkte laufen jetzt monatlich als Momentaufnahme (`schrittweite: 'momentaufnahme'`, kein Backfill). Details in `migrations/0002_stammdaten.sql` und `src/lina/endpunkte.ts`. Drei Punkte bleiben offen:

**Der WAWI-Betriebskontext lässt sich nicht umschalten.** Die Waren-, Lieferanten- und Bestelldaten hängen am aktuell gewählten Betrieb; im Zentral-Kontext kommen 898 Waren, 540 Lieferanten und nur 4 Bestellungen zurück. `storeId` wird von diesen Endpunkten **nicht ausgewertet**. Die gesicherten Einkaufspreise sind damit vorerst die der Zentrale, nicht die der einzelnen Betriebe.
→ **Frage an Concept Family bzw. LINA:** Wie schaltet man den Betriebskontext für WAWI um? Ohne das bleibt die Margenbetrachtung auf die Zentrale beschränkt. Das ist eine Rechte- und Kontextfrage, kein Umsetzungsfehler — es wurde bewusst nicht versucht, sie zu umgehen.

**Der Filterschlüssel der Feinsparten ist ungeprüft.** Feinsparten kommen als `{id, number, name}`, Hauptsparten als `{posId, number, name}`. Bei Hauptsparten erwartet LINA nachweislich `posId` und nicht `number` — mit `number` kommt kommentarlos 0 €. Nach derselben Logik wäre es bei Feinsparten `id`. **Gemessen ist das nicht.** Wir speichern die 334 Feinsparten nur als Dimension und filtern noch nicht danach. Wer sie als Filter benutzt, prüft es vorher gegen eine bekannte Summe, sonst sieht das Ergebnis plausibel aus und ist still falsch.

**Wie oft die Momentaufnahme wirklich laufen sollte, ist eine fachliche Frage.** Monatlich ist gesetzt, weil es billig ist (sieben Anfragen). Ändern sich Einkaufspreise häufiger und will man das sehen, muss der Takt hoch — rückwirkend ist nichts nachholbar, weil LINA keine Preishistorie führt.

## Fachlich

**Konzeptzuordnung: erledigt.** Am 25.07.2026 direkt gegen `getKennzahlen` gemessen — 131 Betriebe, **0 in mehr als einer Gruppe**. Karlsruhe sind fünf eigenständige Betriebe mit fünf Schlüsseln und markenhaltigen Namen („Enchilada Karlsruhe GmbH", „Aposto Karlsruhe GmbH", …). Es ist 1:n. `manual.betrieb_hauptkonzept` bleibt damit voraussichtlich leer.

**Umsatzabweichung Bayreuth und Freiburg.** Karlsruhe stimmt exakt zwischen API und Excel (136.612,46 € vs. 136.612,47 €), Bayreuth (52.712,58 vs. 69.886,44) und Freiburg (125.926,89 vs. 142.090,80) nicht. Vermutlich wurden diese Zeilen manuell aus einer anderen Quelle oder Periode gepflegt. **Vor dem ersten Round Table aus der neuen Datenbank klären**, sonst diskutiert jemand über Zahlen, die aus zwei Welten stammen.

**Fehler im bestehenden Excel.** `Eingabe!K6` referenziert `J7` statt `J6` — die Personal-Ampel ist im JULI-Report um eine Zeile verschoben. Dazu mehrere `#REF!` und `#NAME?` (`_xludf.TEXTJOIN`, LibreOffice-Inkompatibilität). Falls der Juli-Report so kommuniziert wurde, lohnt ein Blick.

**Backfill-Tiefe unbekannt.** Wie weit LINA zurückreicht, ist nicht gemessen. Ein paar lesende Aufrufe klären es.

**`Stornotyp`-Ausprägungen** bleiben unverifiziert, weil kein Betrieb Stornodaten liefert. Struktur ist dokumentiert, Bericht deaktiviert.

## Strategisch

**Amadeus 360 ist das führende System, nicht LINA.** Die Oberfläche sagt es selbst („Die Daten sind nur eingeschränkt änderbar, weil Amadeus 360 nicht führendes System ist"), dazu passen `a360isMaster`, `isSynced` und `syncGroups` im Code. Ein Teil dessen, was wir aus LINA ziehen, ist dort selbst nur eine Kopie. Falls die Datenqualitätsprobleme — Stichwort „Doppelte Artikelnummern, unbedingt korrigieren" aus dem `errors`-Feld — aus dieser Synchronisation stammen, wäre das Vorsystem der bessere Anknüpfungspunkt.
→ **Frage an Concept Family:** Welches System ist führend, und gibt es dorthin direkteren Zugang?

## Sicherheitsbefund (an Concept Family melden)

`GET /einstellungen/api/getStoreData` liefert die Stammdaten des aktiven Betriebs — darunter **`db_name`, `db_user`, `db_pass` im Klartext**, dazu IBAN, BIC und Steuernummer. Die Werte wurden bewusst nicht ausgelesen oder gespeichert. Der Endpunkt ist trotzdem als Stammdatenquelle interessant (Adresse, Öffnungszeiten, Geokoordinaten) — dann aber mit strikter Feld-Whitelist.

## Betrieb

- **Restore testen**, nicht nur das Backup. Dokploys Testfunktion prüft nur den Upload.
- **Plausibilitätsprüfung** muss „Betrieb hat nie BWA" von „Monat noch nicht gebucht" unterscheiden (`core.bwa_buchungsstand`). Sonst schlägt sie jeden Monatsanfang grundlos Alarm: Juni 2026 war am 25.07. erst bei 22 von 131 Betrieben gebucht.
- **Postgres nicht ins Internet exponieren** — Postico über SSH-Tunnel.

## Phase 4

Metabase: zweistufig (Übersicht über alle Marken → Drill-Down je Betrieb), rollenbasierte Rechte über Metabase-Sandboxing plus Postgres-RLS. Der Round-Table-Regelwerk-Schalter wird ein Dropdown mit `mart.regelwerk` als Werteliste.
