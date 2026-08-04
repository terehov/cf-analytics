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

### Tagesbudget 3.000 → 6.000, weil der Takt halbiert wurde
Der Satz oben — *Notfallnetz, nicht Alltagsbremse* — galt für den Takt 20–40 s: im Mittel 30 s, also ~2.880 Aufrufe am Tag, knapp unter der Grenze von 3.000. Am 26.07.2026 wurde der Takt auf 10–20 s halbiert, **das Budget aber nicht mitgezogen.** Damit wurde stillschweigend genau das, was es nicht sein sollte.

Lauf 10 hat es vorgeführt: 3.802 Posten in 16,9 Stunden, dann `Tagesbudget aufgebraucht` — um 13:21 Uhr, mitten am Tag. Gemessen 16,0 s je Posten, hochgerechnet ~5.400 Aufrufe in 24 Stunden. 6.000 liegt darüber, mit demselben schmalen Abstand wie vorher.

**Das ändert die Last je Zeiteinheit nicht.** Was LINA sieht, regeln `TAKT_MIN_MS`/`TAKT_MAX_MS`; die bleiben bei 10–20 s. Das Budget entscheidet nur, wann der Tag vorzeitig endet. Die Lehre ist die Kopplung: wer den Takt ändert, muss das Budget nachziehen — sonst schlägt die Bremse zu, die nie bremsen sollte.

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

### Eine Sperre wartet nicht auf einen Menschen — aber sie meldet sich
*Eugene:* „Falls es in die Sperre kommt, soll es nicht auf eine Freigabe warten, sondern einfach im Zeitintervall von einem Tag neu versuchen oder vielleicht zwei Tagen. Und dann wär's doch sinnvoll, wenn es zu wiederholten Problemen beim Import führt, dass wir benachrichtigt werden über ein Health Endpoint."

**Beides richtig, und zusammen ergibt es erst Sinn.** Die Sperre lief technisch schon immer ab; sechs Stunden Grundpause waren aber eher Wiedervorlage als Ruhepause, und die Verdopplung bis zum Sechzehnfachen hätte daraus über vier Tage gemacht, ohne dass man das der Zahl ansieht. Jetzt ein Tag, höchstens vier. Das Aufheben von Hand bleibt als **Abkürzung**, nicht als Bedingung.

Damit verschiebt sich aber die Frage: wenn niemand mehr eingreifen *muss*, merkt auch niemand mehr, dass etwas ist. Deshalb `/status` — bewusst **getrennt** von `/health`. `/health` ist der Container-Health-Check und darf nur rot werden, wenn ein Neustart hilft; bei einer Zugangssperre hilft er nicht, sondern dreht den Container im Kreis, während LINA gerade nichts von uns hören will. `/status` gibt 503, wenn ein Mensch hinsehen sollte, und niemand startet daraufhin etwas neu. Warnungen bleiben bei 200: Dinge, die man wissen sollte, wecken niemanden nachts.

### Befunde gehören in `docs/`, nicht in die Commit-Nachricht
*Eugene:* „Ich möchte sichergehen, dass alle Explorationen, alle Erkenntnisse, alle Entscheidungen, alle Probleme innerhalb des docs-Ordners stehen und aus `AGENTS.md` verlinkt sind." — Auslöser war der Befund, dass **kein einziger** der gefundenen Fehler in `docs/` stand: das Wissen lag ausschließlich in Commit-Nachrichten und Code-Kommentaren, für den nächsten Agenten praktisch unauffindbar. Daraus `fehlerkatalog.md` und `datenherkunft.md` sowie die Dokumentationspflicht als harte Regel in `AGENTS.md`.

### Der Aktionsbericht wird transformiert, und die leeren Zellen fallen weg
*Eugene:* „Implementiere die beiden Befunde." — `getAktionsbericht` wurde seit dem ersten Lauf geholt und fiel im `switch` in den `default`-Zweig: Posten `ok`, `zeilen: 0`, alles nur in `raw`.

Drei Entscheidungen beim Nachbauen:

**Leere Zellen werden verworfen**, wie beim Artikelverkauf. Am 25.07.2026 waren alle 423 Zellen (141 Betriebe × 3 Aktionen) `null` — wer sie mitschreibt, sammelt 87.000 Zeilen Nichts im Jahr. Der Preis ist derselbe: eine fehlende Zeile heißt „keine Aktion an diesem Tag" **und** „Tag nicht geholt". Welcher Fall vorliegt, beantwortet `sync.warteschlange`.

**Netto oder brutto entscheidet die Antwort, nicht die Anfrage.** Wir fragen immer mit `brutto=0`, gespeichert wird trotzdem nach dem Feld `brutto` im Payload. Wer sich auf die eigene Anfrage verlässt, beschriftet irgendwann Bruttowerte als netto — und das sieht man einer Zahl nicht an.

**Der Nenner für `anteil_pct` kommt aus dem Umsatzbericht**, nicht aus der Summe aller Aktionen. „Anteil an allen Aktionen" wäre eine andere Frage; gefragt ist, wie viel vom *Geschäft* auf eine Aktion entfällt.

### Die BWA-Plausibilität misst die Spitze, nicht die Nachzügler
`core.bwa_buchungsstand` stand seit `0003` im Schema, mit Kommentar und Zweck, und niemand schrieb hinein. Beim Nachrüsten stellte sich die eigentliche Frage: *worauf* soll die Prüfung anschlagen?

Gemessen am 26.07.2026 über 141 Betriebe: 23 auf Höhe der Spitze, 46 im Rückstand (davon 8 mehr als einen Monat), 62 nie gebucht, 10 in keiner Antwort aufgetaucht. Ein Alarm auf die Zahl der Nachzügler wäre also dauerhaft gelb — und eine dauerhaft gelbe Ampel liest nach zwei Wochen niemand mehr.

**Also bewacht `/status` die Spitze:** rückt der jüngste gebuchte Monat über Monate nicht mehr vor, fehlen vermutlich die BWA-Rechte, und dann liefert `getKennzahlen` kommentarlos Nullen — der Ausfall, vor dem `lina-api-inventar.md` seit Phase 1 warnt. Wer im Einzelnen hinterherhängt, steht in `mart.bwa_rueckstand` und wird dort gesucht, nicht gemeldet.

**Drei Zustände, nicht zwei.** `letzter_monat` gesetzt / `NULL` / keine Zeile trennt „hat geliefert" von „nie gebucht" von „nie geprüft". Beim ersten Schreiben der Kommentare wurden die letzten beiden zu einer „72" zusammengefasst — genau der Fehler, den die Tabelle verhindern soll, begangen beim Bauen der Tabelle. Korrigiert in `0016`, festgehalten im `fehlerkatalog.md`.

---

## Drei widerlegte Annahmen aus der Exploration

Alle drei klangen plausibel und waren falsch. Details in `lina-api-korrekturen.md`.

1. **„Der Account sieht die BWA-Zahlen nicht"** — falsch. Verallgemeinerung aus einem einzigen Betrieb, der tatsächlich keine BWA hat. Es ist ein Datenverfügbarkeitsproblem, kein Rechteproblem. Der Blocker war keiner.
2. **„WE-% muss man aus POS-Sparten rechnen"** — falsch und gefährlich: ergibt 45,90 statt 23,64. `getKennzahlen?mode=relativ` liefert die Ampelwerte fertig.
3. **„Der Betriebswechsel ist die offene Architekturfrage"** — gelöst: `storeId=<encId>` als Parameter, kein Session-Wechsel nötig.

---

## Beschreibungen in der Sprache des Fachbereichs (26.07.2026)

**Entscheidung.** Alle in Metabase sichtbaren Texte — Kartennamen, Beschreibungen,
Überschriften, Sammlungen — richten sich an Fachbereichs-Mitarbeitende ohne technischen
Hintergrund. Technische Begründungen wandern in den Quelltext.

**Anlass.** Rückmeldung am Beispiel des Warenwirtschafts-Kopftextes: *„mart.artikelverkauf
liegt bei rund 20 Millionen Zeilen im Jahr und ist monatlich partitioniert."* Für die
lesende Person ist die einzig verwertbare Information: **zuerst einen Zeitraum wählen, sonst
dauert es lange.** Der Rest erklärt eine Bauentscheidung.

**Grenze.** Nicht gekürzt wird, was vor einem Fehlschluss schützt — dass ein weißer Punkt
„keine Daten" heißt und nicht „in Ordnung", dass ein Monat auf null nicht gebucht ist. Diese
Sätze sind der Zweck der Beschreibungen.

**Nebenwirkung, die zählt.** Feste Messwerte („Am 26.07.2026 waren es 79 von 141") sind aus
den Texten verschwunden. Sie veralten still und werden zu falschen Aussagen, die niemand
bemerkt, weil sie plausibel aussehen. Die Aussage bleibt, die Zahl liefert die Karte daneben.

---

## Feste Werteliste statt Feldverweis für Textfilter (26.07.2026)

**Entscheidung.** Die Filter „Betrieb" und „Marke" bekommen ihre Auswahl als feste Liste, die
beim Übernehmen aus der Datenbank gelesen wird.

**Verworfene Alternative.** Verweis auf die Spalte über `value_field`. Im Browser nachgemessen
wirkungslos: Metabase bietet ein Feld-Dropdown nur bei Karten an, deren Filter an einer Spalte
hängt. Bei nativem SQL hängt er an einer Variablen.

**Preis.** Die Liste ist eine Momentaufnahme. **Nach jedem neuen Betrieb muss
`bun run metabase/uebernehmen.ts` einmal laufen**, sonst fehlt er in der Auswahl. Das ist
dokumentiert in `docs/dashboards.md`; der Lauf ist ohnehin nach jeder Änderung nötig.

**Warum trotzdem richtig.** Ein Freitextfeld beantwortet einen Tippfehler mit einem leeren
Dashboard statt mit einer Fehlermeldung — und ein leeres Dashboard ist hier eine plausible,
falsche Auskunft.

---

## Auswahllisten per eigenem Skript statt im Importer (26.07.2026)

**Frage.** Die Filterlisten sind Momentaufnahmen. Niemand weiß im Voraus, wann ein Betrieb
dazukommt — der Importer legt ihn stillschweigend an, sobald LINA ihn liefert. Wie bleibt die
Liste aktuell?

**Verworfen: in den Importer einbauen.** Der bräuchte dafür Metabase-Zugang. Zwei Systeme, die
nichts voneinander wissen müssen, wären aneinander gebunden — und ein Metabase-Ausfall könnte
einen Importlauf scheitern lassen. Dieselbe Trennung, die es zwischen `/health` und `/status`
schon gibt: der Import liefert Daten, das Berichtswesen liest sie.

**Verworfen: API-Schlüssel für Metabase anlegen.** Ein zusätzliches Geheimnis, das verwaltet,
verteilt und irgendwann gedreht werden muss — für eine Aufgabe, die ein `UPDATE` erledigt. Die
Listen stehen in Metabases eigener Datenbank, auf die ohnehin Zugriff besteht.

**Gewählt: `metabase/auswahllisten.ts`, täglich per Cron.** Fasst ausschließlich die
Auswahllisten an — keine Dashboards, kein Layout, kein Browser. Ohne `--setzen` zeigt es nur
an und endet mit Rückgabewert 1, wenn es etwas zu tun gibt; damit ist es auch als reine
Prüfung brauchbar.

**Das eigentliche Problem war nicht das Aktualisieren, sondern das Bemerken.** Ein
ausgefallener Cron-Auftrag lässt die Liste **still** veralten: das Dashboard sieht vollständig
richtig aus, es fehlt nur ein Betrieb im Dropdown, und niemand vermisst, was er nicht sieht.
Deshalb hinterlegt das Skript in `sync.merker`, mit wie vielen Betrieben es abgeglichen hat,
und `/status` zählt nach. Ohne diese Rückmeldung wäre die Automatisierung eine Scheinlösung
gewesen — sie hätte den Fehler nur seltener gemacht, nicht sichtbarer.

---

## Der Listenabgleich hängt am Sync-Lauf (26.07.2026, ersetzt die Cron-Entscheidung von vorhin)

**Anlass.** Die Cron-Lösung war richtig gedacht und in der Praxis wertlos: Sie hätte
eingerichtet werden müssen, und bis dahin wäre nichts gelaufen. Ein Automatismus, der erst
durch eine manuelle Einrichtung entsteht, ist keiner.

**Entscheidung.** `src/sync.ts` ruft den Abgleich nach dem Import auf. Der Sync-Lauf läuft
ohnehin — damit passiert es von selbst, ohne zweiten Zeitplan und ohne dass jemand etwas tut.
Die Adresse von Metabases Datenbank wird aus `DATABASE_URL` abgeleitet, damit auch keine
Umgebungsvariable vergessen werden kann.

**Was das kostet.** Der Importer weiß jetzt von Metabase, was er architektonisch nicht müsste.
Das ist die Kopplung, die in der Entscheidung davor ausdrücklich vermieden wurde — hier
bewusst in Kauf genommen, weil die sauberere Lösung nur auf dem Papier funktioniert hätte.

**Wodurch der Preis gedeckelt ist.** Zwei Zusicherungen, beide mit Test:

1. **Der Nachlauf kann einen Sync-Lauf niemals scheitern lassen.** Die Funktion fängt alles
   und wirft nie. Ein abgestürztes, abgeschaltetes oder nie eingerichtetes Metabase ist kein
   Importproblem. Der Test gibt eine unerreichbare Datenbank vor und prüft, dass der Lauf
   sauber durchläuft.
2. **Er läuft nach dem Import, nie davor.** Die Daten sind wichtiger, und der Abgleich braucht
   den frischen Bestand.

Die Kopplung geht damit nur in eine Richtung: das Berichtswesen hängt am Import, der Import
nie am Berichtswesen.

**Das Skript `metabase/auswahllisten.ts` bleibt** — für den Blick zwischendurch und für eine
frische Metabase-Instanz. Es ruft dieselbe Funktion auf; zwei Umsetzungen desselben Abgleichs
wären zwei Gelegenheiten, dass eine davon still etwas anderes tut.

---

## Eine eigene Seite für die Importüberwachung (26.07.2026)

**Anlass.** „Ich möchte schnell feststellen, wenn etwas scheitert, und woran es liegt."

**Warum nicht in „Datenqualität und Import".** Die Seite gab es schon, aber sie beantwortet
eine andere Frage. Sie fragt **fachlich**: welchen Betrieben fehlen Daten, stimmen die Zahlen
gegen LINAs Aggregate, wer ist beurteilbar. Die neue fragt **technisch**: läuft der Abruf, wie
weit ist er, woran hängt er. Beides auf einer Seite hätte geheißen, dass niemand mehr weiß,
welche Frage er gerade stellt.

**Deshalb eine eigene Sammlung „Technik".** Sie richtet sich ausdrücklich nicht an den
Fachbereich, und dort dürfen Endpunktnamen und technische Begriffe stehen — sie sind die Sache
selbst, nicht ihre Verpackung. Das ist die bewusste Ausnahme von der Sprachregel, die für alle
übrigen Dashboards gilt.

**Was die Seite kann, was vorher fehlte:**

- **Restzeit.** Aus dem Durchsatz der letzten Stunde hochgerechnet. Bewusst kurz gefenstert:
  das Tempo hängt an `TAKT_*` und am Tagesbudget, ein Mittel über Tage würde jede Pause als
  dauerhafte Langsamkeit lesen. Läuft nichts, steht dort „—" statt einer erfundenen Zahl.
- **Was als Nächstes drankommt** — die Warteschlange in genau der Sortierung, die der Worker
  benutzt. Damit ist das abgelesen und nicht geraten.
- **Fehlermuster statt Fehlerliste.** Zeitstempel und lange Zahlen werden im Text ersetzt,
  damit dieselbe Ursache eine Zeile ergibt und nicht hundert. Bei 141 Betrieben erzeugt ein
  einziger struktureller Fehler sonst eine unlesbare Liste.
- **„Tage alt" je Bericht** — die Spalte, an der ein hängender Bericht auffällt.

**Beim ersten Aufruf sofort zwei echte Befunde:** eine aktive Zugangssperre (LINA lehnte die
Anmeldung ab) und 33 `numeric field overflow` bei `getPersonalkosten`. Beides war vorher nur
über eine Handabfrage sichtbar.

**Eine Falle beim Bauen.** `tage_alt` stand für `getKennzahlen` bei **−158**: der Endpunkt wird
je Kalenderjahr geholt, `zeitraum_bis` ist deshalb der 31.12. Eine negative Alterszahl sieht
aus wie ein Fehler und ist keiner — mit `least(geladen_bis, current_date)` gedeckelt.

---

## Eine materialisierte Sicht in `mart`, und nur eine (01.08.2026)

**Anlass.** Nach dem abgeschlossenen Lina-Import gemeldet: einzelne Dashboards sind langsam.
Der Verdacht des Melders war die Tiefe der Historie — relevant seien nur die letzten zwei
Jahre. Nachgemessen betraf es die Seite *Warenwirtschaft*, nicht den Round Table, auf den die
Meldung verwies. Hergang und Messwerte in `fehlerkatalog.md`.

**Warum die naheliegende Lösung nicht die richtige war.** Alte Jahre aus Metabase
auszublenden hätte die schlimmste Karte nicht gerettet: `wa_we_pruefung` liest ohnehin alles,
weil `mart.pruefung_wareneinsatz` Monate absichtlich nebeneinanderstellt und deshalb gar
keinen Zeitfilter haben kann. Bei zwei statt achteinhalb Jahren wäre sie proportional
langsam geblieben — rund 15 statt 62 Sekunden. Der Fehler war strukturell, nicht die
Datenmenge. Eine Zwei-Jahres-Grenze bleibt als Ergänzung sinnvoll und ist bewusst **nicht**
Teil dieser Änderung.

**Entscheidung.** `mart.deckungsbeitrag_warengruppe` wird materialisiert (Migration `0027`) —
als bislang einziges der 34 `mart`-Objekte. Sie verdichtet 27,5 Mio. Zeilen auf rund 174.000,
und dieses Ergebnis ändert sich genau einmal je Importlauf.

**Warum das die Ausnahme bleibt und nicht der neue Normalfall.** Reine Sichten sind hier
richtig: sie können nicht veralten, und `mart` ist genau dafür da, Fallen auszuräumen statt
neue aufzustellen. Eine materialisierte Sicht kehrt das um — sie kann still alt werden. Das
lohnt nur, wo drei Dinge zusammenkommen, und hier kommen sie zusammen:

1. Das Aggregat ist um Größenordnungen kleiner als seine Grundlage (174.000 zu 27,5 Mio.).
2. Es ändert sich nur beim Import, nicht laufend.
3. Es gibt einen Leser, der **nicht** filtern kann und deshalb nie prunen wird.

Fehlt Punkt 3, ist ein richtig gesetzter Zeitfilter die bessere Antwort — er kostet nichts
und veraltet nie. Genau so ist `wa_db_warengruppe` behoben worden und liest die
materialisierte Sicht bewusst *nicht*: dort ist der taggenaue Filter auf `geschaeftstag`
sowohl schneller als auch genauer, weil ein angeschnittener Monat sonst ganz zählte.

**Wodurch der Preis gedeckelt ist.** Dieselbe Konstruktion wie beim Listenabgleich darüber,
mit denselben zwei Zusicherungen und einem Test dafür:

1. **Der Refresh kann einen Sync-Lauf niemals scheitern lassen** (`src/sync/deckungsbeitrag.ts`
   fängt alles und wirft nie). Ein misslungener Refresh heißt veraltete Auswertung, nicht
   verlorene Daten.
2. **Er läuft nach dem Import, nie davor** — vorher würde er den alten Stand neu schreiben.

Dazu eine dritte, die aus der eigenen Verbindung folgt: die Zeitgrenze von 15 Minuten wird im
`finally` zurückgenommen. Bliebe sie an der Verbindung hängen, erbte sie der nächste Nutzer
aus dem Pool, und ein langer Import bräche nach 15 Minuten ab — ohne dass jemand den
Zusammenhang sähe. Auch das ist getestet.

**Und die Frage, die eine materialisierte Sicht immer aufwirft:** „Wie alt sind diese Zahlen?"
beantwortet `mart.deckungsbeitrag_stand`. Ohne sie wäre die einzige ehrliche Antwort ein
Achselzucken — und eine veraltete Zahl, die aussieht wie eine frische, ist genau die Sorte
Fehler, die sich laut `fehlerkatalog.md` nie von selbst meldet.

---

## Eine Prüfsicht, die nicht prüfen kann, wird stillgelegt statt repariert (01.08.2026)

`mart.pruefung_wareneinsatz` ist mit Migration `0029` gelöscht — als `DROP VIEW`,
nicht auskommentiert. Zwei Gründe, jeder für sich ausreichend.

**Erstens, die Herkunft.** Der Sollwert stammt aus `core.artikel.fixer_we`, und
das gilt als „Ergebnis der LINA-Rezepturkalkulation". Seit der Vorgabe vom
27.07.2026 steht fest: LINAs Warenwirtschaft enthält Demodaten, die Rezepturen
werden in FoodNotify gepflegt. Damit ist unklar, was `fixer_we` überhaupt ist.
Eine Prüfsicht, deren Sollwert niemand verantworten kann, prüft nichts.

**Zweitens, und schwerer: sie hat nie ausgelöst.** Ihr eigener Wächter
`abdeckung_pct` filterte auf `fixer_we IS NOT NULL`, doch LINA liefert `0.0000`
statt `NULL` — in 591.464 Zeilen kein einziges `NULL`. Der Wert stand deshalb
ausnahmslos auf 100, während 48 % aller Betriebsmonate gar keinen Ansatz hatten
und ihre Lücke in voller Höhe des BWA-Wareneinsatzes ausgewiesen wurde. Details
im `fehlerkatalog.md`.

**Warum nicht einfach reparieren.** Der Filter ist eine Zeile
(`fixer_we > 0`). Dann meldete die Sicht korrekt, dass sie für die Hälfte aller
Betriebsmonate nichts sagen kann — und lieferte für die andere Hälfte Zahlen,
deren Herkunft weiterhin ungeklärt ist. **Eine Prüfsicht, die zur Hälfte
schweigt und zur anderen Hälfte unbelegte Werte liefert, ist schlechter als
keine: sie sieht aus wie eine Antwort.**

Deshalb `DROP` statt auskommentieren. Eine Sicht, die noch antwortet, wird
benutzt — von Metabase, von einem Kollegen in Postico, von einem späteren Agent,
der den Kommentar nicht liest. Die Metabase-Karte `wa_we_pruefung` und der
Abschnitt auf der Warenwirtschaftsseite sind mit entfernt.

**Was mitgenommen wurde, ohne stillgelegt zu werden.** `abdeckung_pct` in
`mart.deckungsbeitrag_warengruppe` hatte denselben Defekt, ist dort aber nicht
tragend — die Sicht dient der Umsatzgliederung. Sie ist auf `fixer_we > 0`
korrigiert und zeigt jetzt 79 % Durchschnitt statt 100. Nicht stilllegen, aber
auch nicht mit einer Kennzahl weiterlaufen lassen, die falsche Sicherheit
ausstrahlt.

**Was an die Stelle tritt.** Stufe 2.4 aus `docs/plan-foodnotify.md`: der
theoretische Wareneinsatz aus FoodNotifys Zutatenkosten, verknüpft über die am
01.08.2026 gefundene POS-Brücke (`pos_artikel.plu = core.artikel.artikelnummer`,
belegt in `docs/foodnotify-0-1-nummernraum.md`). Dann mit dem Bar/Küche-Split,
den die alte Sicht nie bilden konnte, weil die Hauptsparte am Umsatzbericht
hängt und nicht am Artikel.

**Bis dahin gilt:** keine Entscheidung auf dieser Rechnung aufbauen. Das ist
kein Verlust — die Zahlen waren ohnehin keine.

---

