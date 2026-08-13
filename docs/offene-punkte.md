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

**Standorte für die Karte — der Weg ist offen.** Gewünscht ist eine Deutschlandkarte mit
allen Betrieben, eingefärbt nach der Gesamtampel, anklickbar bis ins Betriebsblatt. Die
Struktur steht (`manual.betrieb_standort`, `mart.standort`, Migration `0008`), die
Koordinaten fehlen.

Am 26.07.2026 gemessen: `getStoreData` **hat** Adresse und Geokoordinaten — aber nur für den
Betrieb, in dem die Session steht (die Konzernzentrale). Neun Parametervarianten wirken
nicht, `storeList` kennt zwei Betriebe und keine Geofelder. Details in
`befunde-datenlage.md`, Befund 8.
→ **Drei mögliche Wege, in dieser Reihenfolge:**
1. **Standortliste bei Concept Family anfragen.** Der einzige Weg ohne LINA-Zustandsänderung.
   Sie führen sie mit Sicherheit — Franchiseverträge, Website, Google Business.
2. **Klären, ob sich der aktive Betrieb lesend umschalten lässt.** Dann liefert
   `getStoreData` je Betrieb Adresse, Koordinaten, Sitzplätze und Fläche — Letzteres wäre
   zugleich die Bezugsgröße für „Umsatz je Sitzplatz". Ein Session-Wechsel verändert
   LINA-Zustand und ist durch Regel 1 in `AGENTS.md` **nicht ohne Freigabe erlaubt.**
3. **Geokodieren**, sobald Adressen aus 1 oder 2 vorliegen.

Ausdrücklich **nicht** aus dem Betriebsnamen ableiten — „Alter Kranen GmbH" trägt keine
Stadt, und fünf Betriebe heißen nach derselben Stadt, ohne dieselbe zu sein. Wie viele
fehlen, sagt `mart.standort_fehlend`.

**Stand 10.08.2026: 60 von 141 sind gepflegt** — Weg 1 hat also teilweise funktioniert. Damit
steht die Karte, und seit demselben Tag hängt noch etwas daran: das Dashboard
*⑩ Betrieb gegen die Stadt* vergleicht einen Betrieb mit den Nachbarbetrieben am selben Ort.

**Sieben laufende Betriebe fehlen noch, und dort wiegt es schwerer als auf der Karte.** Auf
einer Karte fällt ein fehlender Punkt auf. In einem Stadtvergleich fällt ein fehlender Betrieb
**nicht** auf — die Stadt sieht dann einfach so aus, als stünde es nicht darin, und der
Vergleich gibt sich als vollständig aus. Wer diese sieben nachträgt, macht mehr als eine
Karte hübscher.

Es sind ausgerechnet große Betriebe (Monatsumsatz im zuletzt bewerteten Monat, 10.08.2026):

| Betrieb | Marke | Umsatz |
|---|---|---|
| Wirtshaus am Schlossplatz GmbH | Deutsche Konzepte | 745.460 € |
| WHK Gastronomie GmbH | Deutsche Konzepte | 428.451 € |
| Wirtshaus Lautenschlager GmbH | Deutsche Konzepte | 359.055 € |
| BS Bier & Speisen Gastro GmbH | Deutsche Konzepte | 246.500 € |
| SCHAFFERONE GmbH | Kooperationspartner | 191.530 € |
| Gastronomie Wilsdruffer Straße GmbH | Enchilada | 146.188 € |
| B+L Pforzheim GmbH | Deutsche Konzepte | 95.351 € |

**Das umsatzstärkste Betrieb der ganzen Gruppe steht nicht in seiner Stadt.** Fünf der sieben
gehören zu „Deutsche Konzepte" — dort lohnt eine Sammelanfrage mehr als sieben Einzelfälle.
„Gastronomie Wilsdruffer Straße" ist zudem ein Enchilada in Dresden, wo bereits zwei Betriebe
gepflegt sind; diese eine Zeile vervollständigt sofort eine bestehende Vergleichsgruppe.

→ Arbeitsliste mit Umsatz und Zustand: `SELECT * FROM mart.nachbarschaft_fehlend WHERE status = 'operativ';`
oder die unterste Karte auf ⑩.

**79 von 141 Betrieben melden dauerhaft 0 € Umsatz.** Sie liefern über 200 Tage lang
Umsatzberichte, alle leer — Beteiligungsgesellschaften, geschlossene Betriebe, Testeinträge.
`core.betrieb.aktiv` steht bei allen 141 auf `true` und trägt die Unterscheidung nicht.
Folge: jeder Mittelwert über „alle Betriebe" ist um mehr als die Hälfte verdünnt, und
`Enchilada Bremen` steht mit 1109 % Personalquote bei 0 € Umsatz als rote Ampel im Round
Table. → **Frage an Concept Family:** Welche dieser Betriebe sind dauerhaft stillzulegen?
Arbeitsliste: Karte *Betriebe ohne laufendes Geschäft* auf Dashboard ⑥, bzw.
`mart.standort_fehlend` und `mart.datenstand`.

**Backfill-Tiefe unbekannt.** Wie weit LINA zurückreicht, ist nicht gemessen. Ein paar lesende Aufrufe klären es.

**`Stornotyp`-Ausprägungen** bleiben unverifiziert, weil kein Betrieb Stornodaten liefert. Struktur ist dokumentiert, Bericht deaktiviert.

## Strategisch

**Amadeus 360 ist das führende System, nicht LINA.** Die Oberfläche sagt es selbst („Die Daten sind nur eingeschränkt änderbar, weil Amadeus 360 nicht führendes System ist"), dazu passen `a360isMaster`, `isSynced` und `syncGroups` im Code. Ein Teil dessen, was wir aus LINA ziehen, ist dort selbst nur eine Kopie. Falls die Datenqualitätsprobleme — Stichwort „Doppelte Artikelnummern, unbedingt korrigieren" aus dem `errors`-Feld — aus dieser Synchronisation stammen, wäre das Vorsystem der bessere Anknüpfungspunkt.
→ **Frage an Concept Family:** Welches System ist führend, und gibt es dorthin direkteren Zugang?

## Sicherheitsbefund (an Concept Family melden)

`GET /einstellungen/api/getStoreData` liefert die Stammdaten des aktiven Betriebs — darunter **`db_name`, `db_user`, `db_pass` im Klartext**, dazu IBAN, BIC und Steuernummer. Die Werte wurden bewusst nicht ausgelesen oder gespeichert. Der Endpunkt ist trotzdem als Stammdatenquelle interessant (Adresse, Öffnungszeiten, Geokoordinaten) — dann aber mit strikter Feld-Whitelist.

**Er ist inzwischen der kritische Pfad für die Standortkarte** (siehe „Fachlich"): ohne ihn
gibt es keine belastbaren Koordinaten, und geraten wird ausdrücklich nicht. Die Meldung an
Concept Family und die Erschließung gehören deshalb zusammen — wer den Befund meldet, kann
im selben Zug fragen, ob ein bereinigter Endpunkt oder eine Standortliste bereitgestellt
wird.

## Betrieb

- **Restore testen**, nicht nur das Backup. Dokploys Testfunktion prüft nur den Upload.
  **Konkreter Befund dazu (04.08.2026):** `dropdb && createdb && bun run migrate` schlägt
  auf einer wirklich leeren Datenbank fehl — `0039_betriebsstatus_und_plausibilitaet.sql`
  liest eine Spalte, die erst `0041_einkaufspreis_gebinde.sql` anlegt. Der laufende Server
  ist nicht betroffen (andere historische Anwendungsreihenfolge), aber ein Restore oder ein
  neues Dokploy-Deployment würde genau diesen Weg nehmen. Einzelheiten und mögliche Wege in
  `docs/fehlerkatalog.md`, „Von Grund auf migriert bricht die Kette".
- ~~**Plausibilitätsprüfung** muss „Betrieb hat nie BWA" von „Monat noch nicht gebucht" unterscheiden (`core.bwa_buchungsstand`).~~ **Erledigt am 26.07.2026.** Der Ladepfad schreibt den Stand, `mart.bwa_rueckstand` wertet ihn aus, `/status` prüft die Spitze statt der Nachzügler. Drei Zustände statt zwei — siehe `datenherkunft.md`.
- **Postgres nicht ins Internet exponieren** — Postico über SSH-Tunnel.

## Phase 4

Metabase: zweistufig (Übersicht über alle Marken → Drill-Down je Betrieb), rollenbasierte Rechte über Metabase-Sandboxing plus Postgres-RLS. Der Round-Table-Regelwerk-Schalter wird ein Dropdown mit `mart.regelwerk` als Werteliste.

---

## ~~Cron-Auftrag für die Auswahllisten einrichten~~ — erledigt (26.07.2026)

Nicht nötig geworden. Der Abgleich hängt jetzt als Nachlauf am Sync-Lauf (`src/sync.ts`) und
passiert damit von selbst, sobald der Importer läuft — kein eigener Zeitplan, nichts
einzurichten. Begründung in `docs/entscheidungen.md`, Beschreibung in `docs/dashboards.md`.


---

## Die Testsuite ist nicht isoliert (gefunden 01.08.2026)

**Symptom.** `src/sync/e2e.test.ts` allein gegen eine Datenbank: 47 von 47 grün.
Dieselbe Datenbank, aber `bun test` über alle sechs Dateien: **23 Fehlschläge**,
fast alle in der Suite „Zugangssperre".

**Nachgewiesen unabhängig von den Änderungen vom 01.08.2026** — mit
zurückgestashten Änderungen und frischer Datenbank treten dieselben 23 auf.

**Ursache, soweit erkennbar.** Die Testdateien teilen sich Datenbank *und*
Mock-Port (`config.LINA_BASE_URL`) und laufen nebenläufig. Eine gesetzte
`sync.zugangssperre` aus einer Datei legt Läufe in einer anderen still — genau
das, wovor der `afterAll`-Kommentar in der Sperr-Suite warnt („Nicht liegen
lassen: eine aktive Sperre würde jeden weiteren Lauf stilllegen — auch die
anderer Testdateien"). Der Hinweis ist da, die Isolation nicht.

**Warum es nicht auffiel.** Ohne `TEST_DATABASE_URL` werden alle
datenbankgebundenen Tests übersprungen — im Normallauf sind es 61 von 159. Grün
heißt hier „nicht ausgeführt", nicht „geprüft".

**Was es kostet.** Der teuerste Teil der Suite ist praktisch nie gelaufen. Beim
Aufräumen am 01.08.2026 fanden sich drei Tests, die schon vorher rot waren,
darunter einer mit einem echten Denkfehler: Er las
`sync.warteschlange ORDER BY posten_id LIMIT 1` und nahm an, der Worker greife
den zuerst eingereihten Posten — tatsächlich griff er Posten 5. Behoben; die
anderen beiden fielen mit Migration 0030 ohnehin weg.

**Was zu tun wäre** (nicht Teil von Stufe 1.1):

1. Je Testdatei eine eigene Datenbank oder ein `--concurrency 1`, damit der
   geteilte Zustand nicht mehr zwischen Dateien wandert.
2. Je Testdatei einen eigenen Mock-Port.
3. Danach die Suite einmal vollständig grün sehen — vorher ist unbekannt, wie
   viele der 23 echte Befunde sind und wie viele reine Kollisionen.

**Bis dahin gilt:** Wer an `sync/` arbeitet, lässt `e2e.test.ts` **einzeln**
gegen eine frische Datenbank laufen. Ein grüner Gesamtlauf ohne
`TEST_DATABASE_URL` sagt über diesen Teil nichts aus.

---

## `datenherkunft.md`, `importer.md` und `datenmodell.md` sind noch LINA-lastig (gefunden 04.08.2026)

Beim Dokumentieren der Inventuren (Migration `0044`) aufgefallen: Alle drei zentralen
Dokumente beschreiben weiterhin fast ausschließlich LINA. `datenherkunft.md` listet in der
Momentaufnahmen-Tabelle sogar noch `wawi:items`, `wawi:orders`, `wawi:suppliers`,
`wawi:inventory` als „aktiv geholt" — diese Endpunkte und ihre Zieltabellen sind seit
Migration `0030` (01.08.2026) gelöscht, weil es LINA-Demodaten waren (AGENTS.md Regel 5).
Der komplette FoodNotify-Importer (`src/foodnotify/`, zehn Migrationen, `0030`–`0044`)
kommt in keiner der drei Dateien als eigenes Kapitel vor — nur `docs/plan-foodnotify.md`
und die Kommentare in `src/foodnotify/*.ts` selbst sind aktuell.

Diese Aufgabe hat gezielt nur das ergänzt, was zu den Inventuren gehört (siehe die neuen
Abschnitte „FoodNotify: Inventuren" in allen drei Dateien) — die veraltete WAWI-Zeile in
`datenherkunft.md` unangetastet gelassen, um nicht in einer Migrationsaufgabe fremde
Abschnitte umzuschreiben. **Wer als Nächstes an FoodNotify arbeitet:** ein eigener Durchgang,
der Stufe 1–3 (Bestellungen, Rezepturen, POS-Zuordnung, Einkauf) in diesen drei Dateien
nachträgt und die WAWI-Zeile entfernt, wäre die Dokumentationsschuld los, die dieser Fund
aufgedeckt hat.

---

## Die Ursache des `numeric field overflow` ist nicht messbar (gefunden 10.08.2026)

Im ersten echten Inventurlauf (Lauf 79, 09.08.2026) scheiterten neun Posten an
`numeric field overflow`, vier Inventuren von Wilma Wunder blieben ungeladen.
Migration `0046` verbreiterte daraufhin die Mengenspalten, `0047` den Preis.

**Die auslösende Zahl kennt niemand.** `fnLaden` schreibt `raw.api_antwort` und
`core.inventurposition` in **einer** Transaktion (`inTransaktion`). Scheitert das
core-INSERT, rollt der raw-INSERT mit zurück — von genau den Antworten, die den
Fehler ausgelöst haben, existiert deshalb keine Rohantwort. Nachgemessen an den
79.750 erfolgreich geladenen Positionen passte alles längst in die alten Spalten:

| Feld | max. Vorkommastellen | alte Spalte |
|---|---|---|
| `theoreticalStockLevelInBaseUnits` | 10 | `numeric(16,4)` → 12 möglich |
| `countedAmountInBaseUnits` | 8 | `numeric(16,4)` → 12 möglich |
| `reviewAmountInBaseUnits` | 8 | `numeric(16,4)` → 12 möglich |
| `pricePerBaseUnit` | 2 | `numeric(14,6)` → **nur 8 möglich** |

Der Preis war die mit Abstand engste Spalte und ist damit der wahrscheinlichste
Kandidat — bewiesen ist es nicht.

**Was den Fund abschließen würde:** Die vier Posten stehen bei zwei bis drei
Versuchen (Grenze `MAX_VERSUCHE` = 4) und laufen nach dem Deployment von `0047`
von selbst nach. Bleiben sie danach als Fehler stehen, ist die Ursache eine
andere — und dann lohnt es, den Raw-Schreibvorgang aus der gemeinsamen
Transaktion zu lösen (eigene Transaktion oder `SAVEPOINT`), damit eine Antwort,
die core sprengt, wenigstens im Raw-Layer landet. Genau dafür ist er da
(AGENTS.md Regel 4: „Der Raw-Layer ist die Versicherung"), und aktuell greift
diese Versicherung im Fehlerfall nicht.

### Nachtrag 12.08.2026: er ist wieder da, und diesmal an anderer Stelle

Lauf 83 meldete `einkaufspreis-nachlauf gescheitert … numeric field overflow`
(`src/sync/einkaufspreis.ts:55`). Das ist **nicht** dasselbe wie oben und hat mit
dem Ladenakte-Import nichts zu tun — der Nachlauf rührt keine der neuen Tabellen
an. Er ist damit vorbestehend und unabhängig, aber er ist neu genug hier, um ihn
festzuhalten.

Der Nachlauf setzt zwei Anweisungen ab; nur `core.gebinde_vereinheitlichen()`
schreibt Zahlen (`migrations/0040_preis_ausreisser.sql:77-82`). Zwei Divisionen
sind ungeschützt:

```
inhalt    = gesamt_menge / (menge * gebinde_menge)     -- 0040:56, nullif faengt nur die exakte Null
preis_neu = summe_preis  / gesamt_neu                  -- 0040:79-80
```

`gesamt_neu` ist `round(menge * gebinde_menge * inhalt_soll, 4)` und damit
mindestens **0,0001**. Eine Position über 10.000 EUR sprengt so die acht
Vorkommastellen von `core.bestellposition.preis_je_einheit numeric(14,6)`. Lokal
liegen drei Positionen ≥ 10.000 EUR, die grösste bei 124.500 EUR — geteilt durch
0,0001 sind das 1,2 Milliarden.

**Damit ist es diesmal messbar**, anders als beim Fund vom 10.08.: der Nachlauf
liest vorhandene Zeilen, es gibt also keine verlorene Rohantwort. Die
auslösende Zeile findet:

```sql
SELECT bestellposition_key, menge, gebinde_menge, summe_preis,
       round(menge * gebinde_menge * inhalt_soll, 4) AS gesamt_neu
  FROM core.bestellposition
 WHERE round(menge * gebinde_menge * inhalt_soll, 4) > 0
   AND summe_preis / round(menge * gebinde_menge * inhalt_soll, 4) >= 100000000
 ORDER BY 5 ASC LIMIT 20;
```

Der Nachlauf ist bewusst so gebaut, dass sein Scheitern den Import nicht
entwertet („der Import bleibt gültig", `einkaufspreis.ts:55`) — es eilt also
nicht. Zu entscheiden ist, ob die Spalte breiter wird oder ob ein Ausreisser mit
absurd kleiner Menge gar keinen Einheitspreis bekommen soll. Das Zweite ist
vermutlich richtig: ein Preis je Einheit von 1,2 Milliarden ist keine Zahl,
sondern ein Datenfehler, und ihn zu speichern hiesse, ihn zu glauben.

### Widerruf 12.08.2026: die Erklärung oben ist nachgemessen falsch

~~Eine Position über 10.000 EUR sprengt die acht Vorkommastellen.~~ Der Absatz
darüber bleibt als Irrweg stehen, weil er zweimal geschrieben wurde und beim
dritten Mal wieder plausibel klingen würde. Er ist es nicht.

Lauf 84 meldete denselben Fehler erneut. Nachgemessen auf dem lokalen Bestand:

| Grösse | grösster Wert | Grenze der Spalte | Abstand |
|---|---|---|---|
| `gesamt_neu` → `gesamt_menge numeric(14,4)` | 1.800.000 | 10.000.000.000 | Faktor 5.500 |
| `summe_preis/gesamt_neu` → `preis_je_einheit numeric(14,6)` | 46.200 | 100.000.000 | **Faktor 2.165** |

Kein einziger Satz kommt der Grenze nahe; beide Funktionen laufen hier fehlerfrei
durch (`gebinde_vereinheitlichen()` 50.733 Zeilen, `preis_ausreisser_markieren()`
8.297). Die Vermutung war eine Rechnung auf dem Papier, keine Messung.

**Der Grund, warum sie sich nicht widerlegen liess: es ist nicht dieselbe
Datenbank.** `sync.lauf` endet lokal bei Lauf **74**, die letzte Rohantwort
stammt vom **08.08.2026 17:52**. Lauf 83 und 84 stehen hier nicht. Der Zeitplan
schreibt gegen einen anderen Bestand als den, gegen den in dieser Umgebung
gemessen wird — vgl. `DATABASE_URL` in [[deployment-hetzner-stand]].

**Was daraus folgt, und zwar über diesen Fehler hinaus:** jede Zahl, die in
dieser Umgebung gemessen wird, beschreibt den Stand vom 08.08.2026. Das gilt
auch für die Fremdeinkaufs- und Preiszahlen aus 0055/0056. Die Logik ist davon
unberührt, die Beträge sind es nicht.

**Der eigentliche Mangel ist der `catch`.** `String(e).slice(0, 300)` macht aus
einem Postgres-Fehler die vier Wörter `error: numeric field overflow` und wirft
alles weg, was die Frage beantwortet hätte: `code`, `where` (die PL/pgSQL-Zeile,
also welche der beiden Funktionen und welche Anweisung), `detail`, `table`,
`column`. Zwei Läufe lang wurde deshalb geraten statt gelesen. Solange das so
bleibt, ist der nächste Lauf wieder nur ein Gerücht — hier steht bewusst kein
Fix, weil er ohne Zugriff auf den echten Bestand nicht prüfbar wäre.

---

## Round-Table-Map: was nach der Messreihe vom 11.08.2026 übrig ist

Die Fassung für den Fachbereich steht in `docs/datenlage-round-table.html` (und als PDF
daneben). Hier nur, wer was klären muss. **Sieben Punkte, die zunächst als offen galten, sind
es nicht** — sie haben sich durch Nachmessen und Bauen erledigt, nicht durch Freigaben; siehe
[`befunde-datenlage.md`](befunde-datenlage.md).

### Zuerst: sechs Messaufrufe, die Eugene starten muss

`bun run messen d1` bis `d6`. Je ein lesender Aufruf, nicht aus der Agentenumgebung
(Regel 7a). Sie entscheiden, **welche der Rechteanfragen überhaupt gestellt werden muss** —
solange sie nicht gelaufen sind, ist jede Aufwandsschätzung geraten.

| | entscheidet |
|---|---|
| `d1` Kassenjournal | Rechtefrage (403) oder Aufwandsfrage (200)? Der einzige Punkt der Rechteliste, bei dem wir nicht wissen, ob es einer ist |
| `d2` Bericht 107 je Betrieb | ob Kapitel 2.3 (Schichtebene) erfüllbar ist. 2.1 hängt nicht mehr daran |
| `d3` Reservierungs-Schnittstelle | wie groß die OpenTable-Anbindung werden muss |
| `d4` Wetteranalyse | ob `mart.vergleichstag` vollständig wird oder eine externe Wetterquelle braucht |
| `d5` Hauptsparten-Filter | ob der Speisen-/Getränke-Anteil je Zeitfenster für zwei Aufrufe am Tag zu haben ist |
| `d6` Yext `USER_NAME` | ob 3.1 auf Personenebene geht, ohne Bounti |

### An LINA beziehungsweise Concept Family (Rechte)

* ~~**Eigener API-Schlüssel bei LINA anfragen**~~ — **entschieden am 11.08.2026: wird nicht
  angefragt.** Eugene will LINA aus politischen Gründen nicht ansprechen. Die Sache ist
  damit erledigt, nicht offen, und gehört nicht wieder auf die Liste.

  Der Vollständigkeit halber, weil die Erhebung es zutage gefördert hat: es gäbe die
  Schnittstelle. „Sell & Pick" trägt die Scopes *Artikelstammdaten schreiben*,
  *Journaldaten Kasse lesen*, *Personalstammdaten und Kosten lesen* und *BWAs und SuSas
  lesen* — technisch also genau das, wofür wir HTML parsen. **Die Konsequenz ist trotzdem
  keine Anfrage, sondern HTML-Parsing**, und der Parser ist entsprechend gebaut: über
  stabile Zeilennummern statt über Beschriftungen, mit harten Strukturprüfungen, die laut
  scheitern statt still Falsches zu schreiben (siehe `entscheidungen.md`). Regel 7a bleibt
  damit ebenfalls in Kraft — der Lauf gehört ins Terminal des Nutzers oder in den Container.
* **Zwei LINA-API-Schlüssel gehören rotiert** (Sell & Pick, Bounti). Sie stehen im Klartext
  im Stammdatenblatt jedes Betriebs und waren dadurch kurzzeitig in einer Fixture-Datei
  dieses Repositories; die Datei wurde vor dem Commit geschwärzt, die Werte sind nirgends
  persistiert. **Das ist Selbstbedienung, keine Anfrage:** in der Ladenakte unter Stammdaten
  gibt es je Schlüssel „Löschen" und darunter das Formular zum Neuanlegen. Wer rotiert, muss
  vorher wissen, wo die alten Schlüssel im Einsatz sind — Sell & Pick und Bounti laufen
  produktiv, ein Austausch ohne Absprache mit denen legt die Anbindung lahm.
* **Dienstplan freigeben** — Bedarf ist deutlich kleiner geworden: die Ist-Stunden haben wir,
  die **Soll**-Stunden je Tag und Bereich stehen im Tagesbudget der Ladenakte. Der Dienstplan
  bringt nur noch die **Schicht- und Personenzuordnung** für 2.3.
* **Mitarbeiter-Stammdaten** — für 4.2 auf Personenebene.
* **Bericht 118** — inzwischen der *vierte* Weg zum Wareneinsatz und damit der am wenigsten
  dringende.

~~**Betriebskontext lesend umschalten**~~ — weitgehend erledigt: die Ladenakte adressiert
Betriebe über einen Laden-Hash ohne Mandantenwechsel, und Sitzplätze, Fläche und
Gesellschafter stehen im Stammdatenblatt. Offen bleibt davon nur, ob **Einkaufspreise je
Betrieb** anders zu holen sind — was durch das Belegarchiv ohnehin an Bedeutung verliert.

### An den Steuerberater

* **Gesamtpersonalkosten inklusive GF** als BWA-Position, und ob „Personalkosten ohne GF" die
  Lohnnebenkosten enthält. Letzteres geht auch in unseren zurückgerechneten Stundenlohn ein.

### An Concept Family (Pflege — Listen liegen fertig vor)

* **Neun Betriebe ohne Standort *und* ohne Yext-Zuordnung** (`mart.kalender_fehlend`) —
  es ist dieselbe Liste, angeführt vom umsatzstärksten Betrieb der Gruppe. Ein Arbeitsgang.
* **Aktionsstamm bereinigen** — drei Kampagnen behalten, ein Testeintrag mit 47.500 € und
  ein leerer stillzulegen, sieben umzubenennen.
* **Aktionsartikel bestätigen** — Kandidatenlisten liegen bei, ausgewiesen als **unsicher**.
  Nicht automatisch übernehmen: die Probe gegen LINAs bekannten Aktionsumsatz traf zu 104 %,
  358 % und 61 %.
* **Soll-Wareneinsatz für Deutsche Konzepte und Wilma Wunder** — Enchilada (84,4 %) und
  Aposto (67,0 %) sind gepflegt. Bei Deutsche Konzepte fehlen zusätzlich die Warengruppen
  (78,2 % ohne).
* **Gästezählung in 16 Betrieben** — meist kein Defekt, sondern ein laufender Rollout. Muss
  vor dem ersten Report erklärt sein, sonst wird eine Einführung als Rückgang gelesen.
* **84 Betriebe ohne laufendes Geschäft** (`mart.betrieb_status`) — 39 geschlossen, 18 ohne
  Geschäft, 17 verwaltend, 6 inaktiv, 4 Test.
* **Getränkefachgroßhändler je Betrieb: 13 von 141 gepflegt, ein Erhebungsname ohne Betrieb**
  („Carls Brauhaus"). Die Erhebung „GFGH Q2 2026.xlsx" kam mit 8,7 % gefüllten Preiszellen
  zurück; nachgefordert wird sie nicht, abgeleitet wird aus den Rechnungen. Arbeitslisten und
  die Fragen, die dabei übrig bleiben, stehen im Abschnitt „Die GFGH-Erhebung kam leer
  zurück" am Ende dieser Datei.
* **Eröffnungs- und Schließungsdatum** — fehlen ganz. ~~Fläche, Sitzplätze~~ stehen im
  Stammdatenblatt der Ladenakte (Karlsruhe: 632 Plätze, 339 qm). Zu prüfen bleibt, ob die
  Kapazitätstabelle bei **allen** Betrieben gepflegt ist oder nur bei den zwei gemessenen.

### Fachliche Festlegungen

* **Ziel-Rendite, Zielkorridor Personalkosten, Umsatzplan** — nie festgelegt.
* **Ampelschwelle Personalkosten** — steht seit Phase 1 offen. Bei 28/32 leuchtet fast alles
  rot; im Excel war das genauso. Eine Ampel, bei der alles rot ist, steuert nicht mehr.
* **Marktvergleich real oder nominal** — dreht das Vorzeichen. Läuft vorerst nominal.
* **Die sieben Zeitfenster** — Vorschlag steht in `manual.zeitfenster`, auf vollen Stunden.
* **„Zusatzverkäufe" und „Reklamationen" definieren** — drei gemessene Vorschläge liegen vor.
* **Ist „Betriebsergebnis" derselbe Zähler wie EBIT?** Unsere Rendite ist geprüft
  (EBIT ÷ Umsatz, 6.289 Betriebsmonate, Abweichung 0,003 pp). Der Wilma-Wunder-Report, gegen
  den verglichen werden sollte, **liegt nicht im Repository**.

### Neu auf unserer Seite (keine Anfrage, Arbeit)

Aus der Ladenakte-Erhebung, [`lina-api-inventar-ladenakte.md`](lina-api-inventar-ladenakte.md):

* **Langfrist-BWA holen** — 77 Zeilen über 207 Monatsspalten, ein Aufruf je Betrieb. Bringt
  Miete, Mietnebenkosten, Energie, Abschreibungen, Franchisegebühr, Krankheit/Urlaub
  getrennt, Delivery-Anteil und fünf Ergebniszeilen. Günstigste Quelle im ganzen Projekt.
* **Stammdatenblatt holen** — Sitzplätze, Tische, Fläche je Bereich; Gesellschafter; Plan-BWA
  (77 × 12); **Tagesbudget mit Plan-Stunden je Tag und Bereich** (366 Zeilen/Jahr).
* **Belegmetadaten abziehen** — **mindestens 593.314 Belege** — alle 131 Betriebe gezählt (109 mit Daten,
  22 leer), aber nur acht der vierzehn Belegarten, also eine Untergrenze, davon 394.552 Eingangsrechnungen. 621 der 1.048 (Betrieb, Belegart)-Paare sind
  nicht leer, daraus **3.366 Listenseiten** bei 200 Zeilen je Seite. Laufzeit hängt am Takt:
  bei den 4–6 s der laufenden `.env` rund **4,7 Stunden**, bei 1,5–4 s rund 2,6. Ob `length`
  über 200 hinaus geht, ist **ungemessen** — bei 1.000 wären es 1.099 Seiten.
  Kein PDF nötig; `zuordnungFibu` ist der WE-Split an der Rechnung.
  Einzelwerte je Betrieb: [`ladenakte-bestand.csv`](ladenakte-bestand.csv).
* **Harte Sperre gegen Linkverfolgung einbauen** — im Ladenakte-Baum ist *Löschen ein GET*.
  `delete`, `edit`, `upload`, `add`, `set` als Pfadsegmente verbieten, Positivliste statt
  Crawler. Das gehört in den Code, nicht in einen Kommentar.
* **Lohn-Zweig vom Abzug ausnehmen**, bis Zweck und Freigabe benannt sind — dort liegen
  Ausweisdokumente, Geburtsurkunden, Krankmeldungen und Pfändungen.

### Nicht offen, nur noch nicht dran

* **FoodNotify Stufe 2 und der Inventur-Import** sind gebaut und ungestartet. Sie konnten
  nicht aus der Agentenumgebung gestartet werden (`bun run sync` arbeitet LINA und FoodNotify
  in einem Prozess ab, Regel 7a). Obergrenze gemessen: 42 Amadeus-Kostenstellen in 21
  Betrieben mit 33,9 % des Umsatzes, **davon 31 bei Wilma Wunder** — genau der Marke mit
  6,7 % `fixer_we`. Start: `bun run einreihen --foodnotify`, dann
  `--foodnotify-inventuren`, dann `bun run sync`.
* **BWA-Buchungsverzug** — noch nicht messbar, `core.kennzahlen_monat` führt erst acht Tage
  Momentaufnahmen. Braucht keine Anfrage, nur drei Monate Zeit.
* **Lokale Events** — keine automatisierbare Quelle; dafür sieht die Map ein manuelles
  Freifeld vor. Feiertage und Ferien sind seit Migration `0051` erledigt.

### Ladenakte-Import — was nach dem ersten Lauf zu prüfen ist

Der Lader steht und ist gegen echte Fixtures geprüft. Offen bleibt, was sich erst am
laufenden Bestand zeigt:

* **`sachkonto` ist in allen bisher gesehenen Antworten leer.** `cost_account`,
  `cost_account7` und `cost_account0` waren in fünf geprüften Betrieben durchgängig `0`.
  Entweder pflegt Concept Family sie nicht, oder sie stehen woanders. Solange das so ist,
  bleibt `mart.sachkonto_monat` leer — und die Kostenkontenauswertung, die eines der
  Argumente für den ganzen Abzug war, trägt nicht. **Nach dem ersten Lauf messen:**
  `SELECT count(*) FROM core.buchungsbeleg WHERE sachkonto IS NOT NULL`.
* **Der Lieferant ist nur teilweise erschlossen.** Im Fixture 27 von 61. Was die
  Lieferantenkonzentration aussagt, hängt davon ab, wie hoch die Quote im Gesamtbestand
  ist. Vor der ersten Auswertung zählen, nicht schätzen.
* **Ein Fixture aus einem grossen, vollständig erschlossenen Ordner fehlt.** Die vorhandenen
  Fixtures sind klein (61 Belege) und stammen von einer Beteiligungsgesellschaft. Ob ein
  Ordner mit 12.000 Zeilen dieselbe Struktur liefert, ist gemessen (Feldliste identisch),
  aber nicht als Test abgesichert.
* **Die Token-Obergrenze ist unbekannt.** Gemessen sind 172 s Gültigkeit, angesetzt sind 90 s.
  `bun run messen d9` misst die Obergrenze über sieben Minuten. Bis dahin gilt: der Client
  holt bei unbrauchbarer Antwort einmal neu, das trägt auch ohne die Messung.
* **Sechs Belegarten wurden nie gezählt** (16, 3968, 3969, 3971, 3972, 3976). Der Abzug holt
  sie, aber `manual.belegarchiv_soll` führt für sie 0 — sie werden deshalb **nicht
  eingereiht**. Nach dem ersten Lauf einmal von Hand zählen und den Sollbestand ergänzen,
  sonst fehlen sie dauerhaft.

### Nach dem ersten Lauf neu dazugekommen (12.08.2026)

* **28 Betriebe lieferten 77 BWA-Zeilen und keinen einzigen Wert** — nichts wurde
  geschrieben. Der Parser ist nicht die Ursache: hätte er eine Kopfzeile falsch gelesen,
  wäre die Spaltenzahl gegenüber den Datenzeilen verstimmt und der Posten an der Prüfung in
  `src/ladenakte/html.ts:197-201` gescheitert. Er ist es nicht, also hatten alle 77 Zeilen
  ebenfalls exakt so viele Wertzellen wie die Kopfzeile Monate nennt.
* **Die 680 Monatsspalten lösen sich auf, und zwar unangenehm sauber.** Von 01/1970 bis
  08/2026 sind es inklusive **genau 680 Monate**. Auch jede andere beobachtete Zahl passt:
  80 = ab 01/2020, 11 = ab 10/2025. Die Spaltenzahl ist also immer die Spanne vom
  Betriebsstart bis heute — und `680` heisst schlicht **„LINA kennt kein Startdatum für
  diesen Betrieb und hat die Unix-Epoche genommen"**. Das betrifft 13 Betriebe.
  Zu klären: ob diese 13 wirklich keine BWA haben (Holding, nie eröffnet, geschlossen) oder
  ob das fehlende Startdatum in LINA auch die BWA-Berechnung selbst lahmlegt. Das Zweite
  wäre ein Pflegethema bei Concept Family, kein Fehler bei uns.
* **Wie viele Belegordner der NUL-Fehler wirklich gekostet hat, ist unbekannt.** 14
  Fehlerzeilen sind nicht 14 Ordner — die Wiedervorlage liegt bei 2,5 bis 7,5 Minuten und
  der Lauf dauerte 2 h 14 min, derselbe Ordner kam also mehrfach dran. `src/sync/worker.ts:576`
  loggt als einzige der drei Fehlerzeilen weder `postenId` noch `versuche`. **Kleine
  Nacharbeit, die das dauerhaft löst:** diese Logzeile um `postenId` und `versuche`
  ergänzen, so wie es die beiden anderen Fehlerwege tun.
* **`zellenMitWert` zählt Nullen nicht mit.** Ein Betrieb, dessen BWA ausschliesslich echte
  gebuchte Nullen enthält, gilt damit als „ohne Werte" und wird gar nicht geschrieben —
  obwohl der Kopfkommentar von `src/ladenakte/laden.ts` die Unterscheidung zwischen „keine
  Zeile", „NULL" und „0,00" ausdrücklich als tragend führt. Praktisch dürfte das niemanden
  treffen (eine BWA aus 5.236 echten Nullen gibt es nicht), aber die Zählung widerspricht
  der eigenen Regel. Beim nächsten Anfassen geradeziehen.

**Die eine Abfrage, die das meiste davon entscheidet** — sie braucht die Datenbank des
Containers, weil der Rohtext dieser Seiten nur dort liegt:

```sql
SELECT (parameter->>'linaBetriebId')::int AS betrieb,
       (length(payload_text) - length(replace(payload_text, '</tr>', ''))) / 5 AS zeilen_im_html,
       payload_text ~ '01/70'                                   AS faengt_bei_der_epoche_an,
       payload_bytes
  FROM raw.api_antwort
 WHERE endpunkt = 'la:bwa_longterm'
 ORDER BY payload_bytes DESC;
```

---

## Die GFGH-Erhebung kam leer zurück — was das offen lässt (12.08.2026)

Nachgemessen am 12.08.2026 an „GFGH Q2 2026.xlsx": 88 Betriebsspalten, 79 Produktzeilen,
**607 von 6.952 Preiszellen gefüllt (8,7 %)**, ein GFGH-Name in 14 von 88 Spalten, 44 Spalten
ganz ohne Angabe. Entschieden ist, nicht nachzufordern, sondern aus den Rechnungen abzuleiten
(Migration `0055_lieferantenfreigabe.sql`; Begründung in [`entscheidungen.md`](entscheidungen.md),
Aufbau in [`datenmodell.md`](datenmodell.md), Messwerte in
[`befunde-datenlage.md`](befunde-datenlage.md)). Hier steht nur, was dabei für andere übrig
bleibt.

### An Concept Family

* **„Carls Brauhaus" gibt es unter diesem Namen nicht in `core.betrieb`.** Es ist der einzige
  der 14 Erhebungseinträge, der nicht geladen werden konnte (Erhebung nennt „Dinkelacker ja/
  GLH nein"). Entweder fehlt der Betrieb in LINA, oder die Erhebung fragt jemanden ab, der
  nicht zum Bestand gehört — das gehört geklärt, nicht geraten. **Es waren zwei Fälle; seit dem
  12.08.2026 ist es einer**: „Wilma Wunder Markt Mainz" ist vom Nutzer als „Gastronomie am
  Markt Mainz GmbH" bestätigt, die Zeile steht jetzt in der Saat und nicht mehr als
  auskommentierter Vorschlag daneben.
* **Drei Betriebe bestellen über FoodNotify, existieren aber nicht in `core.betrieb`** — Riegele
  Wirtshaus (samt Produktionsküche), Zum Augustiner Rosenheim, Enchilada Darmstadt.
* **Zwei Betriebe bestellen gegen ihren eigenen Status.** „Aposto Wuppertal II" bestellt bis
  02.08.2026; der plausible Betrieb 18 („Aposto Wuppertal – Alter Papierfabrik") steht auf
  `ohne_geschaeft`. „Aposto Aachen – Alte Post" zeigt auf die Betriebe 3 und 71, beide
  `geschlossen` — dazu passt der letzte Beleg vom 28.08.2024. Eines von beiden ist falsch,
  der Status oder die Bestellung.

### Auf unserer Seite: 25 Kostenstellen ohne Betrieb

Nachgemessen am 12.08.2026: **25 von 152 Kostenstellen (16,4 %) haben keinen `betrieb_key`**,
18 davon mit Bestellungen. `mart.fremdeinkauf` filtert auf `betrieb_key IS NOT NULL` und
verliert dadurch **1.127.133 €** über die ganze Historie (3,1 % des Bestellvolumens), 313.770 €
davon aus den letzten 12 Monaten. Es sind fast durchweg echte Betriebe (7 Betriebe, 1.095.156 €)
und nur zu einem Rest Testbetriebe (4 Betriebe, 31.977 €).

Für die GFGH-Frage kostet das genau dort am meisten, wo sie gestellt wird: **GLH Getränke
Logistik Heilbronn liegt mit 84.336 € auf nicht zugeordneten gegen 89.442 € auf zugeordneten
Kostenstellen** — knapp die Hälfte des GLH-Volumens fällt aus der Sicht heraus. Drei Lieferanten
sind darin überhaupt nicht sichtbar (abels fruechtewelt 145.391 €, intergast deutschland 307 €,
„test 1" 3 €).

Es fehlen dabei **immer ganze Betriebe, nie einzelne Bar- oder Küchen-Kostenstellen** eines sonst
zugeordneten Betriebs (für alle 15 betroffenen `restaurant_name` gilt: null zugeordnete
Kostenstellen). Zwei davon sind reine Zuordnungslücke und sofort behebbar: **„Lehners
Karlsruhe" (107) und „Lehners Wirtshaus Rastatt GmbH" (108) existieren, sind `operativ` und
haben null Kostenstellen.** Sie zählen deshalb zugleich fälschlich als „nie FoodNotify" — auf
die Zahlen im nächsten Abschnitt wirkt sich das nicht aus, weil ihre letzten Bestellungen von
2023 und 2022 stammen.

### Der blinde Fleck ist kleiner und schlimmer als „51 von 141"

Die 51 ist richtig gezählt, der Nenner führt in die Irre: in den 141 stecken 39 geschlossene,
18 ohne Geschäft, 17 verwaltende, 6 inaktive und 4 Testbetriebe. **Operativ sind 57, davon
haben 43 FoodNotify-Daten der letzten 12 Monate und 14 nicht** (nachgemessen 12.08.2026).
Diese 14 sind 24,6 % der operativen Betriebe, tragen aber **30,0 % des operativen Umsatzes
(33.530.901 € von 111.868.092 €)**, und zehn von ihnen sind „Deutsche Konzepte". Der blinde
Fleck ist damit fast eine ganze Marke und kein Streuverlust — für diese Betriebe ist das
Belegarchiv nicht die zweite Quelle, sondern die einzige.

### Arbeitsliste: die nicht eingeordneten Lieferanten

`mart.lieferant_freigabe_stand` führt am 12.08.2026 **112 Dachnamen ohne Einordnung, zusammen
6.330.827 €** über die ganze Historie; 69 davon haben seit 08/2025 noch eine Bestellung. In
`mart.fremdeinkauf` sind es für die letzten 12 Monate **71 Lieferanten, 33 Betriebe,
1.116.877 € — 8,3 % des Volumens** (die Arbeitsliste zählt zwei weniger, weil GLH und WIGEM
dort als GFGH stehen und nur bei Betrieben ohne hinterlegten GFGH als „nicht eingeordnet"
gelten). Der Betrag sinkt mit jeder nachgetragenen Freigabe: am Vormittag desselben Tages
waren es noch 1.175.609 €.

| Lieferant (Dachname) | Netto gesamt | Betriebe | letzter Beleg |
|---|---|---|---|
| transgourmet de | 2.654.937 € | 27 | 09.01.2025 |
| FFD Frisch Fruchtig Delp | 621.398 € | 41 | 24.07.2026 |
| getraenke keller | 488.072 € | 2 | 02.08.2026 |
| fruchthof nagel | 426.926 € | 4 | 20.03.2026 |
| trinkkontor | 302.816 € | 3 | 03.08.2026 |
| brauhaus pforzheim | 229.625 € | 2 | 03.08.2026 |
| Splendid Drinks | 161.398 € | 2 | 30.07.2026 |
| lisa mai getraenke gmbh und co kg | 151.690 € | 1 | 02.08.2026 |

**Der größte Posten ist vermutlich kein Posten mehr.** Transgourmet steht mit 2,65 Mio. € an
der Spitze, der letzte Beleg ist vom **09.01.2025** — 27 Betriebe, dann nichts mehr. Entweder
abgelöst oder in einen anderen Namen gewandert; das gehört geprüft, bevor jemand die Liste von
oben abarbeitet und die halbe Zeit in einen erledigten Fall steckt.

### Vier der acht offenen GFGH stehen schon in FoodNotify

Der Kommentar in `0055` sagt, die acht Betriebe mit `dach_name IS NULL` hätten „einen Haendler
genannt, der in FoodNotify nicht vorkommt". Nachgemessen am 12.08.2026 stimmt das für vier
nicht — sie sind ohne das Belegarchiv auflösbar, mit je einer Zeile in
`manual.kreditor_gruppe` und einem `dach_name`:

| Betrieb | Erhebung nennt | in FoodNotify als | Netto | letzter Monat |
|---|---|---|---|---|
| Aposto Aalen | Getränke Keller | `getraenke keller` | 355.230 € | 08/2026 |
| Wilma Wunder Dresden | Hubauer Getränkefachgrosshandel | `hubauer getraenke gmbh` | 83.237 € | 08/2026 |
| Wilma Wunder Recklinghausen | Getränke Weidlich | `getraenke weidlich` | 7.138 € | 07/2026 |
| Enchilada Kempten | Allgäuer Getränkeservice & C+C Oberallgäu | `c c oberallgaeu lang steudler gmbh` | 1.608 € | 02/2024 |

Nebenbefund: **Enchilada Aalen kauft ebenfalls bei Getränke Keller** (132.842 €), hat aber
keinen Erhebungseintrag — die Erhebung erfasst weniger, als die Rechnungen zeigen.

Ein Fall ist ausdrücklich **nicht** aufzulösen: Enchilada Nürnberg nennt „Trinkkartell/Tucher",
`trinkkartell` steht in FoodNotify — aber bei **Wilma Wunder Nürnberg** (8.618 €). Gleiche
Stadt, anderer Betrieb. Hermann Wecken, Getränke Staude und Getränke Express kommen gar nicht vor;
diese drei brauchen das Belegarchiv.

### Zwei Wartestände

* **Das Belegarchiv ist noch leer.** `core.buchungsbeleg`: **0 Zeilen** am 12.08.2026. Alles
  oben ist FoodNotify allein — die zweite Hälfte der Ableitung existiert als Sicht, aber nicht
  als Bestand. Der Abzug muss nicht freigeschaltet werden: `aktiv:false` an den
  Ladenakte-Endpunkten ist **keine Sperre** (`AKTIVE_ENDPUNKTE` filtert nur `ENDPUNKTE`;
  eingereiht wird von `ladenakteNachfuellen()` in `src/sync/nachfuellen.ts`, das den Flag nicht
  liest). Er startet beim nächsten Sync-Lauf von selbst; siehe oben „Belegmetadaten abziehen".
* **Weg B entscheidet über die eigentliche Frage der Erhebung.** Die Excel war im Kern eine
  *Preis*erhebung, artikelgenau. Weg A des Belegarchivs liefert Belegkopf, Lieferant, Sachkonto
  und Nettobetrag — **keinen Artikel, keinen Einzelpreis**. Weg B
  (`/finanzen/document/filelistByBelegart`) hätte ihn, wurde am 11.08.2026 wegen 131
  Mandantenwechseln verworfen. Die Wiedervorlage steht ausformuliert in
  [`entscheidungen.md`](entscheidungen.md) („Offen: Weg B des Belegarchivs liegt durch die
  gescheiterte Erhebung wieder auf dem Tisch"). Offen bleibt hier nur, **wer und wann** — es ist
  eine Entscheidung über Regel 1 (Zustandsänderung in LINA), nicht über Laufzeit, und solange
  sie aussteht, gibt es auf die Preisfrage überhaupt keine Antwort.


---

## Nachtrag 12.08.2026: die Arbeitsliste ist jetzt eine Verdachtsliste

Der Block oben beschreibt die nicht eingeordneten Lieferanten als Pflegeaufgabe ohne
Befundcharakter. Seit der Umstellung auf zwei Zustände (Begründung in
[`entscheidungen.md`](entscheidungen.md)) **sind es Befunde**: 71 Lieferanten, 33 Betriebe,
1.116.877 EUR in zwölf Monaten.

An der Arbeit ändert das nichts, an der Dringlichkeit schon. Reihenfolge nach Volumen:

1. **Trinkkontor** (141.753 EUR, 3 Betriebe) und **Getränke Keller** (134.626, 2) — beides
   Getränkehändler. Entweder sie sind der GFGH dieser Betriebe, dann gehören sie nach
   `manual.gfgh_betrieb`, oder sie sind es nicht, dann ist es ein Befund.
2. **GLH** (99.531, 3 Betriebe **ohne** Hinterlegung) — bei zwei anderen Betrieben ist GLH der
   eingetragene GFGH. Hier ist die Frage konkret beantwortbar.
3. **Segafredo Zanetti** (32.153, 7 Betriebe) — Kaffee gegen die Darboven-Freigabe.
4. Brauereien und Winzer eintragen, damit sie aus der Liste verschwinden.

Ausserdem offen und unverändert: „Carls Brauhaus" hat keine Zeile in `core.betrieb`, und
acht der 13 GFGH-Zeilen tragen keinen aufgelösten Dachnamen.

---

## Erledigt 12.08.2026: der `numeric field overflow` ist gefunden — es war die Menge

Der Punkt weiter oben („Die Ursache des `numeric field overflow` ist nicht messbar") ist
abgeschlossen. Er hat **zwei falsche Erklärungen** überlebt, und beide entstanden aus
demselben Grund: gemessen wurde auf der falschen Datenbank. Sobald der Zugang zur
Produktionsdatenbank stand (Tunnel, siehe `deployment-hetzner-stand` im Gedächtnis), war es eine
Abfrage.

**Es ist nicht der Preis.** Der grösste entstehende Preis je Einheit liegt bei 46.200 gegen
eine Spaltengrenze von 100.000.000 — Faktor 2.165 Luft.

**Es sind genau zwei Zeilen, und die Packungsgrösse wird quadriert:**

| Ware | menge | gebinde_menge | inhalt_soll | gesamt_neu |
|---|---|---|---|---|
| Knusperschnitzel Homestyle | 4 | 432.000 | 432.000 | **746.496.000.000** |
| Kalbsschnitzel roh paniert | 2 | 198.000 | 198.000 | 78.408.000.000 |

Dieselbe Ware wird zweierlei gebucht: die meisten Betriebe tragen die Packungsgrösse in
`gesamt_menge` und lassen `gebinde_menge` auf 1 — daraus wird der Modus `inhalt_soll` =
432.000. Diese Zeile trägt sie in `gebinde_menge`. `menge × gebinde_menge × inhalt_soll`
multipliziert sie dann mit sich selbst. `gesamt_menge numeric(14,4)` fasst zehn
Vorkommastellen.

Eine Zeile brachte drei Läufe lang den ganzen Nachlauf zu Fall — **samt
`core.preis_ausreisser_markieren()`, das danach gar nicht mehr lief.** Auf der Produktionsdatenbank
ist die Ausreisserprüfung also seit Lauf 83 nicht mehr durchgelaufen.

**Migration 0060** prüft, ob das Ergebnis in die Spalte passt. Verworfene Korrekturen
gelten als unentscheidbar (`menge_unstimmig = true`, `preis_je_einheit = NULL`), nicht als
unverändert. Gegen die Produktionsdatenbank nachgerechnet: **79.768 Korrekturen werden geschrieben,
2 verworfen.**

**Der `catch` wirft die Beweise nicht mehr weg.** `src/sync/einkaufspreis.ts` protokolliert
jetzt `code`, `where`, `detail`, `table` und `column`. Zwei Läufe lang wurde geraten, weil
aus einem Postgres-Fehler vier Wörter geworden waren.

### Was offen bleibt: 412 unplausible Korrekturen ohne Überlauf

Von 79.770 Korrekturen ändern **414 die Menge um mehr als das Tausendfache oder weniger als
ein Tausendstel**; zwei davon sprengen die Spalte und sind jetzt gefangen, **412 werden
weiterhin geschrieben**. Grösster Faktor ausserhalb der Absturzzeilen: 60.000.

**Bewusst keine Faktorgrenze gezogen.** 0040 beschreibt selbst, dass FoodNotify die
Gebindeangabe derselben Ware zwischen 0,00035 und 50 meldet — Faktor 142.857, und eine
solche Korrektur wäre nach eigener Beschreibung richtig. Eine Grenze bei 1000 verwürfe
Richtiges mit dem Falschen; das ist derselbe Fehler, der in 0056 schon 37.339 EUR Ersparnis
erfunden hat. Zu klären ist, woran sich eine falsche von einer grossen richtigen Korrektur
unterscheiden lässt — die Antwort liegt vermutlich nicht im Faktor, sondern darin, welches
Feld die Packungsgrösse trägt. Der naheliegende Test (`gebinde_menge = inhalt_soll`) taugt
nicht: er trifft 19.568 Zeilen, von denen 19.547 einwandfrei sind.

---

## Erledigt 12.08.2026: sieben Minuten Nachfüllen, bevor der Lauf beginnt

Lauf 85 brauchte von `start` bis `nachgefüllt` **7:06**, Lauf 84 zwei Stunden zuvor noch
2:47 — bei identischem Ergebnis. Im Nachfüllen gibt es kein Netzwerk.

`einreihenJeMonat` fragte vor jedem Einreihen mit `date_trunc('month', w.zeitraum_von) = …`,
ob es den Posten schon gibt. Das rechnet auf der Spalte und ist nicht indexfähig; die
vorhandenen Indexe sind ausserdem **partiell** (`erledigt_am IS NULL` bzw. `IS NOT NULL`)
und für eine Abfrage, die beides umfasst, unbenutzbar. Gemessen auf der Produktionsdatenbank:

```
Parallel Seq Scan on warteschlange   27 ms
Rows Removed by Filter: 56073 x 3    ->  168.218 Zeilen je Prüfung
```

Bei 420 s Nachfüllzeit rund 15.500 Prüfungen, um 237 Posten einzureihen. **Und es wuchs
quadratisch**: die Tabelle hat 168.218 Zeilen, davon 17 offen — der Rest ist Historie, die
jede künftige Prüfung mitschleppt.

Behoben in **0059** (nicht-partieller Index auf `endpunkt, zeitraum_von`) plus dem
Bereichsprädikat in `nachfuellen.ts`. **Beides ist nötig** — mit dem Prädikat allein blieb
es beim Seq Scan. Nachgemessen an 130.407 Zeilen:

| | vorher | nachher |
|---|---|---|
| Plan | Parallel Seq Scan | Bitmap Index Scan |
| gelesene Zeilen | 168.000 | 212 |
| Buffer | 3.415 | 75 |
| Zeit | 27 ms | **0,65 ms** |

Faktor 41. Aus sieben Minuten werden rund zehn Sekunden.

**Beim Einspielen:** `CREATE INDEX` ohne `CONCURRENTLY` sperrt Schreibzugriffe auf
`sync.warteschlange`, solange er baut — nicht während eines laufenden Syncs einspielen.
`CONCURRENTLY` geht nicht, weil `migrate.ts` jede Migration in eine Transaktion fasst.

### Nachtrag desselben Tages: die 412 sind doch gefangen, und meine Begründung war falsch

Der Absatz darüber („Bewusst keine Faktorgrenze gezogen") ist revidiert. Er bleibt stehen,
weil der Denkfehler darin lehrreich ist.

**Der Fehler.** Ich hatte argumentiert, eine Faktorgrenze bei 1000 verwerfe Richtiges mit
dem Falschen, weil 0040 selbst Gebindeangaben zwischen 0,00035 und 50 beschreibt — Faktor
142.857. Darin steckte eine Verwechslung zweier verschiedener Aktionen:

| Aktion | was übrig bleibt | was eine zu enge Grenze kostet |
|---|---|---|
| Korrektur **verwerfen** | der alte Wert — aus derselben widersprüchlichen Menge | Richtigkeit |
| als **unentscheidbar** markieren | gar kein Preis | Abdeckung |

Nur die erste Aktion ist gefährlich. Die zweite ist die Projektregel selbst: aus unbekannt
darf kein Wert werden. Die 1000 bleibt geraten, entscheidet aber nur, **ob** eine Zahl
behalten wird, nicht **welche** — und das ist der Unterschied zu 0056, wo ein geratener
Schwellwert einen Wert bestimmte und 37.339 EUR Ersparnis erfand.

**Die Messung, die den Ausschlag gab.** Ich hatte behauptet, `preis_ausreisser_markieren()`
fange die Folgeschäden ohnehin ab. Nachgemessen fängt seine Faktor-20-Prüfung **173 der 412
— 42 Prozent**. Die übrigen **239** kämen durch beide Netze und fütterten den
Preisvergleich. Die Behauptung war also nur zu zwei Fünfteln richtig.

**Stand jetzt** (0060 für die Spalte, **0061** für den Faktor; gegen die Produktionsdatenbank
gerechnet):

| | Korrekturen |
|---|---|
| werden geschrieben | 79.356 |
| unentscheidbar wegen Spaltengrenze | 2 |
| unentscheidbar wegen Faktor | 412 |

Kosten: 414 von 876.341 Positionen verlieren ihren Preis je Einheit, 0,05 Prozent.

**Und noch ein Nachtrag, derselbe Fehler zum zweiten Mal an einem Tag.** Die Faktorschranke
stand zuerst als Änderung IN 0060 — die aber seit 14:17 auf der Produktionsdatenbank in
`schema_migration` steht. Der Runner hätte sie übersprungen: lokal grün, auf dem Server nie
angekommen. Genau das war am Vormittag schon mit 0056 passiert und hatte 0057 nötig
gemacht; beim zweiten Mal lautete die Ausrede „0060 steht ja nur lokal", und sie stimmte
nicht. Die Schranke ist deshalb **0061**.

**Regel, jetzt zweimal gelernt:** vor jeder Änderung an einer Migration
`SELECT filename FROM public.schema_migration` — auf der Datenbank, die es betrifft, nicht auf
der lokalen. Die beiden sind hier verschieden.

**Was wirklich offen bleibt** ist nicht mehr die Frage, ob die 412 durchrutschen, sondern
die dahinter: woran liesse sich eine falsche von einer grossen richtigen Korrektur
unterscheiden, **ohne eine Zahl zu raten**? Die Antwort liegt vermutlich darin, welches
Feld die Packungsgrösse trägt — der naheliegende Test (`gebinde_menge = inhalt_soll`) ist
aber widerlegt: 19.568 Treffer bei 21 tatsächlichen Fehlern. Bis das geklärt ist, ist die
Faktorgrenze eine Notlösung, die bewusst zu viel verwirft.

---

## Nach dem Deployment von 0063 zu prüfen (offen seit 12.08.2026)

**Reihenfolge, sonst scheitert es.** Erst pushen, damit der Container 0063 einspielt —
`mart.einkaufspreis_betrieb.sperre` und `gebinde_typisch` gibt es vorher nicht. Dann
`POST /api/database/2/sync_schema`, dann `bun run metabase/uebernehmen.ts`. Wer
provisioniert, bevor die Migration steht, bricht mit „Feld nicht gefunden" ab — und die
neuen Karten `sp_waren`/`sp_positionen` stünden angelegt, aber leer.

**Was gegengeprüft werden muss:** der Belegarchiv-Zweig von `mart.fremdeinkauf` ist lokal
nicht prüfbar (die lokale Datenbank führt 0 Buchungsbelege). Die Gegenprobe sind die vier
Summen der letzten zwölf Monate, gemessen vor dem Umbau:

| Quelle | Einordnung | netto |
|---|---|---|
| belegarchiv | freigegeben | 19.979.323 |
| belegarchiv | nicht freigegeben | 7.930.024 |
| foodnotify | freigegeben | 14.502.396 |
| foodnotify | nicht freigegeben | 300.750 |

Weichen sie ab, liegt es am Umbau und nicht an neuen Daten — der Sync lädt zwar weiter,
aber nicht in dieser Grössenordnung.

**Der erste Refresh läuft ohne Netz.** `REFRESH ... CONCURRENTLY` braucht eine gefüllte
Sicht; gefüllt wird sie beim `CREATE` in der Migration, also im Containerstart. Dauert das
zu lange, bricht der Start ab und der Container läuft nicht an. Lokal kostet der Aufbau
6,9 s bei 634.175 Positionen und 0 Belegen; auf der Produktionsdatenbank kommen 394.575
Belege dazu. Falls der Start hängt: `sync.merker` unter `einkauf_sichten_refresh` zeigt
die Dauer des letzten regulären Refreshs.

**Eine verwaiste Abfrage steht noch auf der Produktionsdatenbank** (PID 36368, seit
14:03 UTC, `psql`, `WITH zeile AS (...)` über `core.bestellposition`). Sie stammt aus der
Diagnose am Vormittag: der Client wurde beendet, der Server rechnet weiter. Ein Abbruch
per `pg_cancel_backend(36368)` wurde von der Freigabe der Agentenumgebung abgelehnt und
muss von Hand kommen. Sie schadet nichts ausser Rechenzeit, aber sie hat an den gemessenen
Ladezeiten mitgewirkt.

## Neun Objekte haben ihre Kommentare verloren (gefunden 12.08.2026)

Beim Umbenennen fiel auf, dass `COMMENT ON`-Texte verschwinden, wenn eine Sicht per
`DROP ... CASCADE` neu gebaut wird — die abhängigen Sichten entstehen ohne sie. Für die
Objekte, die davon am 12.08. betroffen waren, holt Migration `0066` die Texte zurück.
Ohne Kommentar sind aber noch:

| Objekt | zuletzt beschrieben in |
|---|---|
| `mart.standort` | Sicht besteht, Text weg |
| `mart.ampel_bereich` | " |
| `mart.round_table_trend` | " |
| `mart.konzept_schnitt_monat` | " |
| `mart.ursachen_analyse` | " |
| `mart.einkaufspreis_veraenderung` | " |
| `core.lieferant.liefertage` | Spalte |
| `core.ware_stand.listenpreis` | Spalte |
| `core.buchungsbeleg.sachkonto_` | Spalte |

**Warum das mehr ist als Kosmetik:** in Metabase steht an diesen Objekten weiter die
Beschreibung vom letzten Sync — eine Konserve, die niemand mehr über die Datenbank
erreicht. Ist der Text seither fachlich falsch geworden, liest ihn trotzdem jeder, der
auf das Info-Zeichen klickt. `uebernehmen.ts` zieht nur nach, wo ein Kommentar *steht*;
ein fehlender überschreibt nichts.

**Reihenfolge beim Aufräumen:** den Text aus der Migration holen, in der er zuletzt
stand, gegen den heutigen Stand der Sicht lesen (er kann veraltet sein), und in einer
neuen Migration setzen. Nicht blind zurückkopieren.

---

## Nach dem Deployment von `0069` zu prüfen (offen seit 13.08.2026)

Phase 1 von `docs/plan-datenvollstaendigkeit.md`. Die Reparaturen sind deployt, aber ihre
Wirkung zeigt sich erst am nächtlichen Lauf.

1. **Der erste Lauf mit `la:belegzahl` ist lang.** 1.834 Zählungen plus 262 Token-Aufrufe bei
   rund 3 s Takt sind etwa 1,7 Stunden — der Lauf davor brauchte 14 Minuten. Das ist
   erwartet. Was **nicht** erwartet ist: dass er die 10.500 reißt. Gegenprobe am Morgen
   danach:
   ```sql
   SELECT lauf_id, count(*), min(beendet_am), max(beendet_am) FROM sync.aufgabe
    WHERE lauf_id = (SELECT max(lauf_id) FROM sync.aufgabe) GROUP BY 1;
   ```
2. **Der erste Lauf reiht viele Abzüge nach**, weil sechs Belegarten und zehn Betriebe nie
   gezählt wurden. Wie viele, sagt `mart.belegarchiv_zulauf` mit `zustand = 'abzug fehlt'`.
   Bleibt diese Zahl über mehrere Tage stehen, greift das Nachreihen nicht — dann hinsehen.
3. **Was in den sechs nicht freigegebenen Belegarten liegt**, ist ab dem ersten Lauf messbar:
   ```sql
   SELECT typ_id, ordner, sum(gezaehlt) AS belege, count(*) FILTER (WHERE gezaehlt > 0) AS betriebe
     FROM mart.belegarchiv_zulauf WHERE NOT inhalt_holen GROUP BY 1,2 ORDER BY 3 DESC;
   ```
   Das ist die Entscheidungsgrundlage für Punkt 3 in Abschnitt 4 des Plans. **Eugene
   entscheidet**, nicht der nächste Agent.
4. **Die beiden Nachläufe sind noch nicht gelaufen** — sie laufen neben dem nächtlichen Lauf
   und brauchen einen bewussten Befehl:
   ```bash
   bun run einreihen --foodnotify-inventurpositionen   # 358 Aufrufe, holt die 936 Positionen
   bun run einreihen --aufgegebene --endpunkt fn:bestellpositionen   # 275 Aufrufe
   ```
   Danach müssen `mart.inventur_abgeschnitten` leer sein und die 322 Bestellungen ohne
   Position auf 47 gesunken.
5. **Ob die 275 wirklich wiederkommen, ist offen.** Sie sind alle mit HTTP 500 gescheitert,
   und zu FoodNotify gibt es keinen Kontakt. Scheitern sie erneut mit demselben Code, ist es
   eine Quellengrenze und gehört als solche dokumentiert — dann nicht ein drittes Mal
   versuchen.

## Der e2e-Test braucht eine Testdatenbank auf aktuellem Stand (13.08.2026)

`lina_e2e_test` steht auf `0042` und ist damit 27 Migrationen hinter Produktion. Von 0
aufbauen geht nicht: `0039` scheitert, und `0055` scheitert an einem Seed, der Betriebe
voraussetzt (`gfgh_betrieb.betrieb_key` NOT NULL gegen eine leere `core.betrieb`).

Was funktioniert hat, für den nächsten, der davorsteht:

```bash
createdb lina_e2e_0069
pg_dump --schema-only --no-owner --no-privileges lina | psql -q -d lina_e2e_0069
psql -d lina -tAc "COPY (SELECT filename, angewendet_am FROM public.schema_migration) TO STDOUT" \
  | psql -d lina_e2e_0069 -c "COPY public.schema_migration (filename, angewendet_am) FROM STDIN"
pg_dump --data-only --no-owner -t 'core.marke' -t 'core.hauptsparte' -t 'ampel.*' lina \
  | psql -q -d lina_e2e_0069
DATABASE_URL="postgresql://postgres@localhost/lina_e2e_0069" bun run migrate
TEST_DATABASE_URL="postgresql://postgres@localhost/lina_e2e_0069" bun test --timeout 60000 src/sync/e2e.test.ts
```

Zwei Dinge, die dabei Zeit gekostet haben:

* **`--timeout 60000` ist nötig.** Der FoodNotify-Durchstich braucht auf einem frischen
  Schema mehr als die 5 s, die bun voreinstellt; läuft er in den Timeout, hält er die
  Advisory-Sperre und **alle** folgenden Läufe melden `lauf_uebersprungen`. Das sieht dann
  nach fünf kaputten Tests aus und ist einer.
* **Die Datei nie mit `-t` filtern** (AGENTS.md / `docs/fehlerkatalog.md`): der Namensfilter
  umgeht die Notbremse und der Test trifft die Produktivdatenbank.

Fünf Tests scheitern auf einem so gebauten Schema **auch ohne jede Codeänderung** — zwei
BWA-Sichten und eine Mart-Sicht, weil die materialisierten Sichten nie befüllt wurden, und
zwei Budgetgrenzen, weil `config` beim ersten Import einfriert. Wer eine Änderung bewertet,
misst gegen diesen Stand und nicht gegen null.
