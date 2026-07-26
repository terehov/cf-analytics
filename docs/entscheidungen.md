# Entscheidungsprotokoll

Chronologisch, inklusive der revidierten. Wer sich fragt „warum eigentlich so", findet hier die Begründung — und wo eine frühere Empfehlung falsch war, steht das auch.

---

### Kein offizieller Zugang bei Gastro-MIS
*Eugene:* Concept Family hat den Glauben verloren, dass LINA jemals den nötigen Stand erreicht, und baut bewusst eine Parallelwelt. Es wird dort nicht um API-Zugang gebeten.
**Folge:** Die Integration ist per Design inoffiziell. Daraus folgen zod-Validierung bei jeder Antwort, append-only Raw-Layer, unauffälliges Anfragetempo und die Bereitschaft, dass es ohne Vorwarnung bricht.

### Schattendatenbank statt Live-Durchreichen von Nutzer-Zugangsdaten
Die Idee, jeden Nutzer sich mit seinen LINA-Daten anmelden zu lassen und live durchzureichen, löst die Rechtefrage elegant, scheitert aber an Credential-Handling, voraggregierten Endpunkten, fehlender Historie und session-gebundenen Betriebs-Reports. **Hybrid:** Daten aus der eigenen Datenbank, LINA-Login perspektivisch nur für Authentifizierung und RLS-Scope.

### Ein Hetzner-Server mit Dokploy, kein Kubernetes
*Eugene:* möglichst einfache erste Version, Postgres ist bekannt, direkter Zugriff mit Postico gewünscht.
Der Postico-Punkt ist kein Komfortargument: Wir bauen ein Schema über eine undokumentierte API. Ein interaktiver `raw->>'feld'`-Kreislauf gegen den JSONB-Layer findet Fehlinterpretationen in Minuten statt Wochen — das ist das größte Risiko der Phasen 2 und 3.

### ~~Bunny Magic Containers für die Datenbank~~ → verworfen
Persistent Volumes dort: 10 MB/s, 100 GB, node-gebunden, **keine Replikation, keine Backups**, Datenverlust bei Hardwareausfall. Für ein Archiv, dessen Zweck Unabhängigkeit ist, das falsche Fundament. Bunny Storage S3 wird stattdessen als **Backup-Ziel** genutzt — dafür reichen Multipart und Listing, und es ist eine andere Ausfalldomäne als Hetzner.

### vanilla Postgres 18
StarRocks, DuckDB pur und pg_duckdb verworfen (Begründungen in `architektur.md`). pg_ducklake bleibt als Option offen, Wechselkriterium: Mart über 50 GB oder Dashboards regelmäßig über 3 Sekunden.
**Nicht 19:** am 16.07.2026 Beta 2, GA erst September/Oktober, das Projekt rät von Beta im Produktivbetrieb ab.

### ~~Zeitzone im Container setzen~~ → korrigiert
*Eugene:* „Wäre es nicht sauberer, beim Übertragen in UTC umzuwandeln, statt in Docker die Zeitzone zu ändern?" — **Richtig.** Die Container-TZ war *tragend*; wer sie ändert oder vergisst, verschiebt still die Tagesgrenze. Jetzt laufen Container und Datenbank in UTC, `Europe/Berlin` steht an zwei Stellen, umgerechnet wird nur an der Grenze.

### ~~RAG statt Ampel~~ → zurückgenommen
Zwischenzeitlich war alles anglisiert (RAG, `fact_*`, `dim_*`).
*Eugene:* „Da wir hier wirklich nur die Analysen für Lina bauen, sollten wir die Bezeichnungen alle von Lina übernehmen." — Überzeugend: Das Schema bildet genau ein Quellsystem ab, und jede Übersetzung ist eine Fehlerquelle. Die **einzige** legitime Abweichung von der LINA-Welt ist die UTC-Umrechnung.

### Ampel-Schwellen: beide, umschaltbar
Global (Excel-Blatt „Regeln", 28/32) als Standard für die Vergleichbarkeit, betriebsindividuell (LINAs `pekThreshold`) als zweite Sicht. Umschalten ist ein Funktionsargument. Dazu `mart.round_table_vergleich()` mit `weicht_ab` — die fachlich interessantere Frage ist nicht, welche Schwellen richtig sind, sondern **wo die Wahl überhaupt ein anderes Urteil ergibt**.

### YEXT und OM-Score gehören dazu
Online-Bewertung kommt aus YEXT (eigener Sync, eigener Rhythmus, explizite Zuordnungstabelle — Namen matchen nicht zuverlässig). OM-Score, Ursachen und Maßnahmen sind handgepflegt. Metabase kann nicht schreiben: v1 per CSV-Upload, später kleine Eingabemaske.

### Storno wird nicht gebaut
*Eugene:* wird offenbar nicht genutzt — anders sind die Nullen überall nicht zu erklären. Zwei Indizien stützen das: Die vier hinterlegten Stornogründe (`Bruch/Kork`, `verderb`, `schwund`) sind Schwundgründe, keine Kassiervorgänge; und LINA ist bei Concept Family nicht das führende System. Im Register als deaktiviert vermerkt.

### Backfill: maximale Tiefe, tagsüber, konstanter Rinnsalbetrieb
*Eugene:* „Tagsüber fällt es weniger auf." — **Richtig, und das dreht die frühere Nachtfenster-Empfehlung um.** Ein einzelner Client um drei Uhr früh ist im Log ein Ausreißer; dieselben Anfragen im Tagesverkehr von 141 Betrieben nicht. Dazu laufen LINAs eigene Importe vermutlich nachts.
**Designfolge:** kein getrennter Backfill- und Sync-Modus, sondern eine Warteschlange mit Prioritäten.

### node-postgres statt postgres.js
*Eugene:* gute Erfahrungen, läuft auch in Bun. Bei der Umstellung gleich eine Falle entschärft: `pg` parst `DATE` sonst in Ortszeit zu einem `Date` — das kann den Geschäftstag um einen Tag verschieben. Der Parser ist in `src/db/pool.ts` abgeschaltet.

### Dockerfile statt Nixpacks
Bun ist bei Nixpacks der schwache Punkt, und der Service läuft unbeaufsichtigt gegen eine unversionierte API — da muss nachvollziehbar sein, welche Bun-Version im Image war.

### ~~Arbeitsfenster 7–23 Uhr~~ → entfernt, durchgehend
*Eugene:* „Wir brauchen das Zeitfenster gar nicht. Lass es einfach konstant in dem Tempo ganz ruhig weiterlaufen." — **Überzeugend, und es dreht die eigene Begründung von oben weiter.** Wenn schon „tagsüber fällt es weniger auf", dann gilt erst recht: ein Gerät, das jeden Abend schlagartig verstummt und morgens wieder anspringt, ist eine Kante im Log. Ein gleichmäßiges Rinnsal rund um die Uhr ist keine. Was das Tempo begrenzt, sind `TAKT_*` und `TAGESBUDGET`, nicht die Uhrzeit. Das Budget stieg dabei von 2.000 auf 3.000 — es soll das Notfallnetz sein, nicht die Alltagsbremse.

### Ein Worker, abgesichert per Advisory-Sperre
`FOR UPDATE SKIP LOCKED` verhindert doppelte Posten, aber nicht doppeltes Tempo — und das Tagesbudget zählt jeder Prozess für sich im Speicher. Seit dem Wegfall des Arbeitsfensters läuft ein Backfill viele Stunden, der stündliche Zeitplan würde also Lauf um Lauf danebenstarten. Zehn Worker wären zehnfaches Tempo gegen einen Zugang ohne Limits. Die Sperre liegt auf einer **eigenen** Verbindung, nicht auf einer gepoolten: sonst wartet `pool.end()` auf sie.

### Stammdaten historisieren statt überschreiben
LINA kennt für Stammdaten keine Historie. Eine Verkaufsmenge ohne den Einkaufspreis und die Warengruppe, die **damals** galten, ist eine Zahl ohne Bedeutung. Durchgängiges Muster: `<ding>` hält den aktuellen Stand für Joins, `<ding>_stand` die Historie je Monat, append-only. Betrifft Artikel, Warengruppen, Waren, Einkaufspreise.

### Einkaufspreise monatlich, nicht wöchentlich
Zwischenzeitlich auf wöchentlich umgestellt.
*Eugene:* „Ok, lasse die Preise monatlich. Der Import dann aber auch!" — Die Umstellung war ohnehin die falsche Antwort auf das eigentliche Problem: die Momentaufnahmen liefen gar nicht monatlich, sondern täglich (siehe `fehlerkatalog.md`). Behoben wurde der Takt, nicht die Frequenz erhöht.

### Partitionskinder in ein eigenes Schema `part`
*Eugene:* „Das Core-Thema ist mit ganz vielen Artikeltabellen für die Tage voll." — 84 von 110 Tabellen in `core` hießen `artikelverkauf_tag_2023_07`. In Postico lästig, in Metabase unbenutzbar. Die Kinder liegen jetzt in `part`, die Elterntabellen bleiben in `core` und `raw`. Metabase synchronisiert `part`, `raw` und `sync` gar nicht erst.

### Zehn Migrationen zu sechs zusammengefasst
Möglich geworden durch *Eugene:* „Ich bin okay damit, die Datenbank neu aufzusetzen." Der Stand ließ sich zuletzt nur durch Nachspielen der Historie lesen — `0005` korrigierte eine Aussage aus `0000`, `0007` einen Entwurfsfehler aus `0000`, `0009` einen aus `0003`. Die Begründungen sind vollständig erhalten und stehen jetzt an der Stelle, die sie erklären. **Ab hier gilt wieder: angewendete Dateien werden nicht mehr geändert.**

### Fremdschlüssel auf `core.artikelverkauf_tag`
Bisher waren `betrieb_key` und `artikel_key` dort namenlose Zahlenspalten. Metabase liest Fremdschlüssel aus dem Katalog und bietet daraufhin von selbst den Sprung zum Betrieb und zum Artikel an. Kosten: zwei Indexzugriffe je Zeile auf zwei dauerhaft gecachte Tabellen (141 bzw. 6.451 Zeilen) — gegen einen Takt von 20–40 Sekunden je Anfrage nicht messbar.

### Der Round Table wird eine Sicht, nicht nur eine Funktion
Metabase kann tabellenwertige Funktionen im Abfrage-Editor nicht benutzen; `mart.round_table(monat)` war nur über eine SQL-Frage mit Parameter erreichbar. `mart.round_table_monat` ist dieselbe Bewertung als Sicht über alle Monate, mit dem Standardregelwerk. Die Funktion bleibt für den Fall, dass jemand die betriebsindividuellen Schwellen braucht — ein Regelwerk ist kein Filterkriterium, sondern eine Rechenvorschrift.

### Warengruppe gilt rückwirkend, der Wareneinsatzansatz nicht
Beide Momentaufnahmen laufen nur vorwärts. Ohne Rückgriff hätte die gesamte Historie keine Warengruppe, und `mart.deckungsbeitrag_warengruppe` wäre außerhalb des laufenden Monats leer. Eine **Einordnung** ändert sich selten, die älteste bekannte ist die beste verfügbare Schätzung — ausgewiesen als `warengruppe_geschaetzt`. Ein **Preis** dagegen ist eine konkrete Zahl, und ein Preis von heute auf 2023 angewandt ist eine konkret falsche. Deshalb dort ein ehrliches `NULL`.

### Der tägliche Lauf holt ein Fenster, nicht einen Tag
LINAs Konzernberichte füllen sich über fünf bis sechs Tage — nachgemessen, Reihe in `importer.md`. „Gestern" zu holen schrieb Nullen fest, und zwar dauerhaft, weil der Posten danach als erledigt gilt. Jetzt zehn Tage rückwärts. Die Zieltabellen sind Upserts; 80 zusätzliche Aufrufe am Tag gegen ein Budget von 3.000.

### Dashboards werden aus dem Repository erzeugt, nicht in der Oberfläche geklickt
Eine zusammengeklickte Auswertung hat keine Historie, keine Begründung und keinen zweiten Ort, an dem sie überlebt — dasselbe Argument wie beim Schema. Die Definitionen liegen in `metabase/`, `uebernehmen.ts` trägt sie ein. Wiedererkannt wird über `[key:...]` in der Beschreibung, nicht über den Namen: einen Namen darf jemand in der Oberfläche ändern, ohne dass eine Kopie entsteht.
**Preis:** Wer eine Karte in Metabase *inhaltlich* ändert, verliert die Änderung beim nächsten Lauf. Das ist gewollt.

### Der Übernehmer ist ein Proxy, kein API-Schlüssel
Metabase schickt `connect-src 'self'`; seine eigene Seite darf die Kartendefinitionen nicht von außen holen. Statt einen API-Schlüssel anzulegen — ein zusätzliches Geheimnis, das jemand später wieder aufräumen müsste — liefert ein lokaler Server unter `:8899` die Seite *und* reicht `/api/*` weiter. Die Anmeldung kommt vom Browser selbst, weil **Cookies je Host und nicht je Port gelten**. Nichts wird gespeichert.

### Das Kachel-Layout wird gerechnet, nicht gepflegt
Auslöser waren überlagerte Kacheln und abgeschnittene Texte im Browser. Von Hand gepflegte `y`-Werte halten bis zur ersten Höhenänderung weiter oben; Metabase nimmt Überlappungen klaglos an, und der Fehler erscheint als Darstellungs-, nicht als Definitionsproblem. In `dashboards.ts` steht seither nur noch, **was nebeneinander gehört**; `layout.ts` rechnet Position und Größe, `uebernehmen.ts` bricht bei Überlappung ab.

### Keine zwei Y-Achsen, gekappte Balken, Median statt Mittelwert
Drei Darstellungsentscheidungen mit je einem konkreten Anlass. **Zwei Y-Achsen** (Euro links, Prozent rechts) lassen sich beliebig gegeneinander verschieben und erfinden eine Beziehung, die nicht in den Daten steht — aufgeteilt in zwei Karten. **69 Betriebe** auf einer Balkenachse ergeben übereinanderliegende Namen — gekappt auf Top 20, vollständige Reihe als Tabelle daneben, nicht statt ihrer. **Mittelwerte** verziehen sich an einem einzigen Ausreißer; bei einer Personalquote von 1132 % bei 0 € Umsatz ist das kein Randfall, sondern der Normalzustand dieser Daten.

### Vier Rückfallmonate statt einem
Ein Pflichtparameter ohne Vorgabe lässt jede Karte beim ersten Öffnen scheitern, ein fester Vorgabemonat veraltet. Der Rückfall muss aber **je Datenreihe verschieden** sein: der Round Table hat für Juli ein Urteil (er trägt den letzten gebuchten BWA-Monat nach), EBIT endet im Juni. Ein gemeinsamer Rückfall erzeugte eine leere EBIT-Karte neben gefüllten — und die liest sich als „kein EBIT", nicht als „noch nicht gebucht".

### Die Standortkarte wartet auf Koordinaten, statt sie zu erfinden
*Eugene:* „Sollte es nicht möglich sein, Geodaten zu bekommen oder die Position eindeutig zu bestimmen, bitte nicht raten und nicht implementieren." — Danach, auf den Hinweis, `getStoreData` führe Geokoordinaten: „Dann lies sie dort aus und ignoriere die Datenbankzugangsdaten."
**Gemessen am 26.07.2026:** Der Endpunkt führt sie tatsächlich (`geo_lat_ort`, `geo_long_ort`, dazu Straße, PLZ, Stadt, Fläche, Sitzplätze) — aber ausschließlich für den Betrieb, in dem die Session steht, und das ist die Konzernzentrale in Gräfelfing. Neun Parametervarianten (`storeId`, `store`, `id`, `encId`, `laden`, je mit `enc_id` und numerischer ID) liefern alle dieselbe Antwort. `storeList` in `/common/api/account` kennt zwei Betriebe und keine Geofelder.
**Folge:** Die Struktur ist gebaut (`manual.betrieb_standort` mit ausgewiesener `herkunft`, `mart.standort`, `mart.standort_fehlend`), gefüllt wird sie erst, wenn Koordinaten aus einer belastbaren Quelle vorliegen. Der einzige verbliebene LINA-Weg wäre ein Wechsel des aktiven Betriebs — der verändert Zustand und ist durch Regel 1 ausgeschlossen. Begründung fürs Warten statt Raten: **ein Betrieb an der falschen Stelle auf einer Karte wird nicht hinterfragt, ein fehlender schon.**

### Standorte werden nicht aus Betriebsnamen geraten
*Eugene:* „Sollte es nicht möglich sein, Geodaten zu bekommen oder die Position eindeutig zu bestimmen, bitte nicht raten und nicht implementieren." — Die Suche über alle 489 archivierten API-Antworten ergab: LINA liefert für Betriebe keine Adresse, für **Lieferanten** dagegen schon. Die Ableitung aus dem Namen wäre teilweise möglich („Aposto Aalen"), aber nicht vollständig („Alter Kranen GmbH") und nicht eindeutig (fünf Betriebe heißen nach derselben Stadt).
**Folge:** `manual.betrieb_standort` mit ausgewiesener `herkunft` und `genauigkeit`, gefüllt von Hand oder aus einer Liste von Concept Family. Die Karte zeigt genau die Betriebe, die darin stehen. Begründung: **ein Betrieb an der falschen Stelle wird nicht hinterfragt, ein fehlender schon.**

### Takt auf 10–20 s, und eine Sperre wird als Sperre behandelt
*Eugene:* „Auch später auf Production kannst du dir Zeit auf zehn bis zwanzig Sekunden stellen. Allerdings, falls es dort eine Sperre gibt, brauchen wir dafür eine Graceful Behandlung." — Zwei Messungen tragen die Halbierung: über 526 Aufrufe antwortet LINA in 623 ms bei 30.228 ms Wartezeit (**98 % Leerlauf**), und ein beaufsichtigter Lauf bei 5–12 s über mehrere hundert Aufrufe blieb ohne jede Reaktion. 10–20 s liegt dazwischen und in dem Bereich, den auch ein Mensch beim Durchklicken erzeugt.

**Die Bedingung ist der wichtigere Teil.** Beim Bauen der Sperrbehandlung kam heraus, dass der Importer auf eine Sperre bisher mit dem Gegenteil des Richtigen reagierte: Posten als `aufgegeben` abschreiben, zehnmal nachfassen, stündlich wiederholen — und im schlimmsten Fall zehn Anmeldeversuche in Folge gegen ein sperrbares Konto, also genau das, was harte Regel 6 verbietet. Jetzt ist eine Sperre eine eigene Ergebnisart, der Lauf endet sofort, der Posten bleibt unangetastet, und die Pause steht in `sync.zugangssperre` — in der Datenbank, weil sie sonst den stündlichen Neustart nicht überlebt.

### Befunde gehören in `docs/`, nicht in die Commit-Nachricht
*Eugene:* „Ich möchte sichergehen, dass alle Explorationen, alle Erkenntnisse, alle Entscheidungen, alle Probleme innerhalb des docs-Ordners stehen und aus `AGENTS.md` verlinkt sind." — Auslöser war der Befund, dass **kein einziger** der gefundenen Fehler in `docs/` stand: das Wissen lag ausschließlich in Commit-Nachrichten und Code-Kommentaren, für den nächsten Agenten praktisch unauffindbar. Daraus `fehlerkatalog.md` und `datenherkunft.md` sowie die Dokumentationspflicht als harte Regel in `AGENTS.md`.

---

## Drei widerlegte Annahmen aus der Exploration

Alle drei klangen plausibel und waren falsch. Details in `lina-api-korrekturen.md`.

1. **„Der Account sieht die BWA-Zahlen nicht"** — falsch. Verallgemeinerung aus einem einzigen Betrieb, der tatsächlich keine BWA hat. Es ist ein Datenverfügbarkeitsproblem, kein Rechteproblem. Der Blocker war keiner.
2. **„WE-% muss man aus POS-Sparten rechnen"** — falsch und gefährlich: ergibt 45,90 statt 23,64. `getKennzahlen?mode=relativ` liefert die Ampelwerte fertig.
3. **„Der Betriebswechsel ist die offene Architekturfrage"** — gelöst: `storeId=<encId>` als Parameter, kein Session-Wechsel nötig.
