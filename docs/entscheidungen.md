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

## Kein Support-Kontakt bei FoodNotify — es geht auch ohne (01.08.2026)

Vorgabe Eugene. Der Plan sah in Stufe 0.2 ein Ticket mit drei Punkten vor.
Geprüft, was daran wirklich hing — und das Ergebnis ist: nichts, was den Bau
aufhält.

**Die POS-Zuordnung** war der einzige Punkt, der als Blocker galt. Sie ist am
selben Tag selbst gefunden worden (`docs/foodnotify-0-1-nummernraum.md`): über
die `connectionId` aus `/api/pos/locations`, nicht über eine Account-ID. Der
Support wäre der bequemere, nicht der einzige Weg gewesen.

**Der Verkaufsfehler** (`column t0.root_recipe_id does not exist`, 100 % der
Stichproben) blockiert FoodNotifys eigene Abrechnung von Verkauf gegen
Rezeptur. Er blockiert **nicht uns**, denn wir brauchen diese Abrechnung nicht:

```
core.artikelverkauf_tag.menge  ×  Σ zutat.cost  =  Soll-Wareneinsatz
        (LINA, funktioniert)      (FoodNotify, gepflegt)
```

Die Verkaufsmengen kommen aus LINA — derselbe Amadeus-Datenstrom, nur in der
funktionierenden Fassung. Die Zutatenkosten stehen fertig gerechnet am Rezept
(`zutat.cost`, Euro je Portion). Die Multiplikation ist unsere, und sie umgeht
genau die Kette, die bei FoodNotify bricht.

**Belegt statt behauptet:** Aposto Gera, Juni 2026, 40 der 146 zugeordneten
Rezepte ergeben 2.902,58 € Soll-Wareneinsatz auf 14.660,83 € Umsatz = **19,8 %**.
Plausibel (üblich 25–33 %, hier fehlen noch zwei Drittel der Rezepte,
überwiegend Speisen). FoodNotifys eigene Kostenanalyse weist für dieselbe Marke
**−2667 %** aus.

**Daraus folgt mehr als nur „kein Ticket".** B2 (Verkäufe) und B3
(Kostenanalyse) sind gestrichen, nicht zurückgestellt:

* **B2** wäre dieselbe Zahl ein zweites Mal, in der kaputten Fassung.
* **B3** war als Vergleichsgröße gedacht. Eine Vergleichsgröße muss selbst
  belastbar sein; diese ist es in keiner der vier Marken. Sie taugt weder als
  Wahrheit noch als Prüfstein.

Stufe 4 schrumpft damit auf die Inventuren, und die hingen nie am Fehler.

**Die Anmeldung braucht ebenfalls keine Rückfrage.** Gemessen: kein JWT im
`localStorage`, `/api/profile` antwortet trotzdem mit 200 — die Sitzung hängt an
einem HttpOnly-Cookie. Dasselbe Muster wie bei LINA, `src/lina/auth.ts` trägt
konzeptionell schon. Ob 2FA greift, zeigt der erste Anmeldeversuch; darauf zu
bauen, bevor es auftritt, wäre Spekulation.

**Was wir uns damit einhandeln.** Zwei Dinge bleiben ungeklärt und sollen es
bewusst bleiben:

1. **Der Fehler bleibt bestehen.** Wer in FoodNotifys Oberfläche auf die
   Kostenanalyse sieht, sieht weiterhin Phantasiewerte — ohne Warnung. Das ist
   jetzt ein Thema für die Fachseite, nicht für den Importer.
2. **Die geteilten Administratorkonten bleiben.** Ein lesender Subuser wäre
   sauberer und ließe sich in der Oberfläche selbst anlegen. Kein Blocker,
   aber auch nicht erledigt.

---

## LINAs Warenwirtschaft wird gelöscht, nicht umgebaut (01.08.2026)

Migration `0030` legt die FoodNotify-Tabellen an und räumt dabei acht Tabellen
aus `0002`/`0003` ab: `core.ware`, `ware_stand`, `lieferant`, `bestellung`,
`bestellposten`, `einkaufspreis_stand`, `einheit`, `inventurtermin`.

**Warum überhaupt.** Sie halten LINAs Warenwirtschaft, und die ist laut Vorgabe
vom 27.07.2026 Demodaten. Vorgefunden: 898 Waren, 540 Lieferanten — aber **vier
Bestellungen mit 18 Positionen**. Ein Verhältnis, das die Antwort schon enthielt.

**Mit echter Wirkung.** `mart.preisentwicklung_ware` las diese Tabellen und
lieferte 1.111 Zeilen. Die Metabase-Karte „Einkaufspreise im Verlauf" zeigte
diese erfundenen Preise als echte an — ohne Kennzeichnung. Ihre eigene
Beschreibung war im Rückblick der Hinweis: *„Die Reihe beginnt mit der ersten
Erfassung — für die Zeit davor gibt es keine Preise, weil sie nirgends
gespeichert wurden."* Bei FoodNotify ist es genau umgekehrt: die Historie
entsteht aus den Bestellungen selbst und reicht bei Aposto bis Oktober 2021.

Das ist innerhalb eines Tages der zweite Fall derselben Sorte, nach
`mart.pruefung_wareneinsatz` in `0029`: **eine Zahl, die aussieht wie eine
Antwort.** Beide Karten sind entfernt.

**Warum löschen statt umbauen.** Die alten Strukturen tragen LINAs Begriffe und
LINAs Annahmen: `lina_id` als Schlüssel, `listenpreis` (Katalog- statt
Belegpreis), `liefertage`, `mindestbestellwert`. Es fehlen Marke, Kostenstelle
und Belegnummer — die drei Achsen, um die es bei FoodNotify geht. Ein Umbau wäre
ein Zwitter, dem man in einem Jahr nicht mehr ansieht, welche Spalte woher
stammt. Und `UPDATE`-Migrationen auf Tabellen, deren Inhalt ohnehin wertlos ist,
sind Arbeit ohne Ertrag.

**Was bleibt, und warum.** `raw.api_antwort` ist append-only und behält alle
geholten Antworten (Regel 4) — es ist nichts unwiederbringlich weg. Die
Transformationsfunktionen in `src/transform/index.ts` bleiben samt Tests stehen:
sie sind rein, beschreiben LINAs Antwortstruktur und haben Arbeit gekostet.
**Gelöscht wird die Datenhaltung, nicht das Wissen, wie man die Antwort liest.**

**Was abgestellt statt gelöscht wird.** Die fünf `wawi:`-Endpunkte in
`src/lina/endpunkte.ts` stehen auf `aktiv: false`, mit Befund und
Antwortstruktur im Kommentar. Wer später fragt „haben wir das mal geprüft?",
findet dort die Antwort statt einer Lücke. Die fünf Ladefälle in
`src/sync/laden.ts` sind entfernt — ohne Zieltabelle wären sie ein Laufzeitfehler
mit Ansage.

**Nicht angefasst:** `manual.betrieb_fremd_id`. Ihr Primärschlüssel
`(betrieb_key, system)` lässt nur **eine** Fremd-ID je Betrieb und System zu,
ein LINA-Betrieb hat aber **zwei** FoodNotify-Kostenstellen (Bar und Küche). Die
Zuordnung sitzt deshalb als `betrieb_key` an `core.kostenstelle` — n:1 statt
1:1. Die bestehende Tabelle bleibt für YEXT unverändert.

---

### Yext: Portalwahl erst in der Sicht, nicht im Importer
*03.08.2026, mit Schlüssel gegen das Produktivkonto gemessen.*

Die API kennt **keinen** Aggregat-Endpunkt (`/reviewsAggregate` → 404). Dafür
liefert die normale Bewertungsliste `count` und `averageRating` im Kopf mit;
zusammen mit `maxPublisherDate` ist das ein vollständiges Aggregat je Stichtag
für **einen** Aufruf. Der Importer holt deshalb Stände, nicht Bewertungen —
und rührt personenbezogene Felder nie an.

**Facebook rechnet nicht mit.** Bei Enchilada Hamm: 2.001 Bewertungen gesamt
(Schnitt 4,30), davon 1.639 bei Google (4,32), 164 OpenTable, 119 Facebook —
und Facebook führt Einträge *ohne* `rating`, weil es mit „empfohlen / nicht
empfohlen" arbeitet. Das ist Frage 5 aus `yext-anbindung.md`, empirisch
beantwortet: ein Mittelwert über alle Portale mischt zwei Skalen.

Die Ampel steht bei 4,40 zu 4,00, die Portalwahl verschiebt den Wert also über
die Schwelle hinweg. Gespeichert wird deshalb **je Portal** (`ALLE` und
`GOOGLEMYBUSINESS`), entschieden wird erst in
`manual.online_bewertung_aus_yext()`. Läge die Entscheidung im Importer, würde
ein Meinungswechsel 3.000 Aufrufe kosten; so kostet er ein `UPDATE`.

### Yext: kumulierter Stand als Kennzahl, Monatswert daneben
Die Zahl, die bisher von Hand in den Round Table getippt wurde, ist die, die
ein Gast auf Google sieht — der Schnitt über **alle** Bewertungen. Der Schnitt
der Bewertungen *eines* Monats ist etwas anderes: Enchilada Hamm hatte im Juli
2026 neun Stück, ein Ausrutscher bewegt das um eine halbe Note. Eine Ampel
darauf wäre Rauschen mit Farbe.

`core.bewertung_stand` hält deshalb den kumulierten Stand je Monatsende. Der
Monatswert geht nicht verloren — er ist die Differenz zweier Stände und steht
in `mart.bewertung_verlauf` als Frühwarnung neben dem Stand. Ein Aufruf je
Betrieb und Monat liefert beides.

**Fehlt der Vormonat, bleiben die Monatsspalten NULL.** Eine Lücke in der Reihe
würde sonst zwei Monate zu einem verschmelzen und als besonders starker Monat
gelesen. Deshalb lädt der Backfill 25 statt 24 Monate: der älteste Monat hat
keinen Vorgänger und trägt nur den Anker.

### Yext bekommt keinen Wartetakt, sondern Serialität
*Eugene:* „da es eine API ist, kannst du die requests ohne zu warten der Reihe
nach abfeuern, nur nicht parallel."

LINAs 10–20 Sekunden sind Tarnung — ein Mensch am Report Center, ein einziger
Zugang, eine Sperre wäre nicht rückgängig zu machen. Yext ist eine
dokumentierte, bezahlte API mit ausgeschriebenem Limit von 5.000 Aufrufen je
Stunde. Dort ist eine künstliche Pause keine Vorsicht, sondern verschenkte
Zeit.

Gemessen: 453 ms je Aufruf, also ~2,2/s bei strikt serieller Abarbeitung. Der
Backfill über 25 Monate sind rund 3.000 Aufrufe in gut 20 Minuten — unter dem
Stundenlimit, solange **ein** Lauf arbeitet. Genau deshalb ist Serialität die
Bremse und Parallelität ausgeschlossen: sie würde diese Rechnung zerstören.
Reagiert wird nur auf ein echtes Bremssignal (429/5xx, `Retry-After` als
Untergrenze).

### Yext: der Zugang ist nicht auf uns begrenzt — der Import muss es sein
Alle 115 Entitäten des Kontos liegen unter **einer** `accountId`. Die
wichtigste Bitte aus `yext-anbindung.md` §1 ist damit nicht erfüllt: der
Schlüssel sieht auch Gimme Gelato, Pommes Freunde, my Indigo und die
Soulkitchen Gruppe — 43 Standorte fremder Kunden der Family & Friends
Marketing. Getrennt wird nur der Ordnerbaum, und ein Ordnername ist eine
Beschriftung, keine Grenze.

**Maßgeblich bleibt `manual.betrieb_fremd_id`.** Der Importer lädt
ausschließlich zugeordnete Betriebe. Der Ordnerfilter in
`src/yext_zuordnen.ts` engt nur ein, wer überhaupt zur Zuordnung vorgeschlagen
wird — er entscheidet nichts.

### Yext: einzelne Bewertungen doch — mit Text, ohne Namen
*03.08.2026. Revidiert ausdrücklich `yext-anbindung.md` §3.*

Dort stand, Bewertungstexte würden **nicht** gespeichert, und eine Textauswertung
käme „als eigener Antrag mit eigener datenschutzrechtlicher Prüfung — nicht
durch die Hintertür dieses Zugangs".

*Eugene:* „Ich möchte hier die einzelnen besten und schlechtesten Bewertungen
lesen können." Das ist dieser Antrag, und er ist berechtigt: eine Zahl sagt,
**dass** ein Betrieb abrutscht. Erst der Text sagt, **woran** — Service, Wartezeit,
Küche. Ohne ihn ist die Kennzahl eine Ampel ohne Ursache, und die roten Betriebe
im Round Table wären eine Liste ohne Handlungsanweisung.

**Was gespeichert wird:** Note, Datum, Portal, Text, Autorenname, Link zur Quelle.
**Was nicht:** `authorEmail` und die Antworten des Betriebs (`comments`). Der Typ
`YextBewertung` in `src/yext/client.ts` führt diese Felder gar nicht erst; was
nicht im Typ steht, landet auch nicht versehentlich in einem `INSERT`.

> **Der Autorenname kam erst im zweiten Anlauf dazu.** Migration 0037 hat ihn
> ausdrücklich weggelassen — er sei das einzige Feld, das eindeutig eine Person
> benennt, und zum Lesen brauche ihn niemand.
> *Eugene, am selben Tag:* „Lad die Autoren der Bewertungen mit. Beim Abgeben der
> Bewertung haben sie der Verarbeitung zugestimmt."
> Das trägt, und es ist mehr als eine Formalie: der Name steht bei Google,
> TripAdvisor und OpenTable öffentlich neben dem Text, sichtbar für jeden — wir
> speichern nichts, was dort nicht ohnehin steht. Dazu kommt der praktische Teil:
> wer auf eine Kritik antworten will, muss wissen an wen, und dieselbe Person, die
> dreimal in einem Monat einen Stern vergibt, ist etwas anderes als drei
> enttäuschte Gäste. Ohne Namen sieht beides gleich aus.
> Nachgezogen in `migrations/0038_bewertung_autor.sql`.

**Die Kennzahl bleibt beim Aggregat.** `core.bewertung` ist zum Lesen da, nicht
zum Rechnen. Eine gelöschte Bewertung verschwindet bei Yext sofort aus dem
Durchschnitt, unsere Kopie bliebe stehen — wer aus dieser Tabelle einen Schnitt
rechnet, bekommt eine andere Zahl als der Round Table, und zwar die falsche.

## Das FoodNotify-Tagesbudget geht auf 90.000, für die Dauer des Backfills (03.08.2026)

**Was war.** `FN_TAGESBUDGET=40000`. Bei einem Takt von 800–1500 ms sind rechnerisch
rund **75.000** Aufrufe am Tag überhaupt möglich, gemessen waren es 49.700 (Lauf 65:
46.853 Posten in 22,6 Stunden). Das Budget endete den Tag also **vor** dem Takt — am
03.08.2026 bei 40.003 Aufrufen. Der Lauf danach hatte 1.778 FoodNotify-Posten in der
Schlange, konnte keinen davon anfassen und schob sie auf den Folgetag.

**Was offen war.** 1.778 Bestellseiten. Jede Seite bringt 25 Bestellungen, und jede
Bestellung zieht Kopf und Positionen nach — also rund **90.000 Aufrufe**, bis der
Backfill durch ist. Bei 40.000 am Tag wären das zweieinhalb Tage, in denen jeden Abend
alles liegen bleibt und am nächsten Morgen wieder anläuft.

**Die Entscheidung.** 90.000. Das liegt über der physischen Obergrenze des Takts —
während des Backfills bremst also der **Takt**, nicht das Budget. Das ist der Punkt:
was FoodNotify sieht, regeln `FN_TAKT_MIN_MS`/`FN_TAKT_MAX_MS`, und die bleiben
unangetastet. Die Last je Zeiteinheit ändert sich nicht, nur die Uhrzeit, zu der der
Tag endet.

**Warum das Budget trotzdem stehen bleibt.** Es ist kein Tagesplan mehr, sondern ein
Netz gegen einen kaputten Takt — ein versehentliches `FN_TAKT_MIN_MS=0` liefe sonst
ungebremst gegen einen fremden Dienst. Ein Netz, das nie greift, ist besser als keins.

**Was danach gilt.** Zurück auf 40.000, sobald der Bestell-Backfill durch ist. Im
Alltag sind es ein paar hundert Aufrufe täglich, und dann ist ein enges Netz das
richtige. Der Wert steht mit dieser Begründung in der `.env`, nicht nur hier.

**Unterschied zu LINA.** Dort bleibt es bei 10.500 — LINA ist ein Report Center mit
genau einem Zugang, FoodNotify ein bezahlter REST-Dienst mit dokumentierten Endpunkten.
Zwei Anbieter, zwei Verträge, zwei Risiken; seit dem 02.08.2026 auch zwei Budgets.

## Inventuren bleiben ein reiner Backfill — kein laufender Abgleich in nachfuellen.ts (04.08.2026)

**Die Frage.** `src/sync/nachfuellen.ts` zieht für Bestellungen stündlich die
jeweils NEUESTE Seite je Kostenstelle nach (`foodnotifyNachfuellen()`), weil neue
Bestellungen sonst für immer unentdeckt blieben — der Backfill kennt nur die
Seiten, die es beim Start gab. Sollen Inventuren dasselbe bekommen?

**Dagegen entschieden.** Bestellungen sind das Gegenteil von Inventuren: 11.578
Stück bei Aposto allein, täglich neue, und wirtschaftlich sofort relevant
(Einkaufspreise). Inventuren sind laut `docs/foodnotify-api-inventar.md` §8b
eine „Runde Monatsinventuren" — bei Wilma Wunder 275 über zwei Jahre, das sind
grob 10–15 im Monat, bei den anderen drei Marken einstellig bis niedrig
zweistellig **insgesamt**. Eine stündliche Abfrage würde 24-mal am Tag prüfen,
ob sich etwas geändert hat, das sich im Schnitt alle zwei bis drei Tage ändert —
und nur bei Wilma Wunder überhaupt in einer Menge, die eine Schwundrechnung
trägt (275 Stück, 154 signiert; bei Aposto und Deutsche Konzepte ist die
inventurgestützte Schwundrechnung laut Plan ohnehin nicht möglich).

**Dazu kommt die technische Form.** `fn:inventuren` bündelt ALLE Kostenstellen
einer Marke in einem Aufruf (`erpIds[]`) — anders als bei Bestellungen ließe
sich „die letzte Seite je Kostenstelle" hier nicht direkt übertragen, das
Nachziehen bräuchte eine eigene Logik (letzte Seite je MARKE, nicht je
Kostenstelle), keine Wiederverwendung der bestehenden Funktion.

~~**Die Entscheidung.** Inventuren bleiben ausschließlich ein manueller Backfill
(`bun run einreihen --foodnotify-inventuren`, analog `--foodnotify` für die
Organisationsposten und `--historie` für LINA). Kein Eintrag in
`nachfuellen.ts`. Wer neue Inventuren sehen will, ruft den Backfill erneut —
das idempotente `NOT EXISTS` verhindert dabei keine neuen Seiten, sondern nur
einen zweiten Seite-1-Posten je Marke (siehe der Hinweis in `src/einreihen.ts`
zum Nachziehen neuer Kostenstellen).~~ **Revidiert am 05.08.2026, siehe unten.**

**Was das revidieren würde.** Zeigt sich nach dem ersten echten Backfill, dass
Wilma Wunder tatsächlich laufend neue Inventuren anlegt und die Zahl regelmäßig
gebraucht wird (nicht nur einmalig für eine Schwundanalyse), lohnt sich ein
eigener „letzte Seite je Marke"-Zweig in `foodnotifyNachfuellen()` — dann mit
gemessenen Zahlen statt der hier getroffenen Vorabschätzung.

## Inventuren laufen doch im Sync mit — Anforderung Eugene (05.08.2026)

**Revidiert die Entscheidung darüber.** Eugene: „ich möchte, dass die
Inventuren auch automatisch gezogen und dargestellt werden. sprich wir
brauchen einen backfill und sync". Damit ist die Bedingung eingetreten, die
der Absatz „Was das revidieren würde" selbst benannt hatte — die Zahl wird
laufend gebraucht, nicht einmalig für eine Schwundanalyse.

**Umgesetzt** als `inventurenNachfuellen()` in `src/sync/nachfuellen.ts`,
aufgerufen je Marke aus `foodnotifyNachfuellen()`. Drei Dinge, die dabei
anders sind als bei den Bestellungen:

- **Je Marke, nicht je Kostenstelle.** `fn:inventuren` bündelt alle
  Kostenstellen in einem Aufruf (`erpIds[]`), es gibt also gar keine
  Seitenzahl je Kostenstelle. Genau deshalb ließ sich die bestehende
  Funktion nicht wiederverwenden — die eigene Logik, die der alte Eintrag
  als Aufwand veranschlagt hatte.
- **Die Seitenzahl steht woanders.** `/api/erp/*` liefert die erp-Hülle mit
  `payload.pagination.totalPages`; die Bestellungen nutzen das flache
  `page_count` aus `/api/{erpId}/*`. Ein Griff an die falsche Stelle liefert
  NULL statt eines Fehlers — der Abgleich liefe still ins Leere, derselbe
  lautlose Fehlertyp, der bei Wilma Wunder schon einmal 275 Inventuren
  übersah.
- **Die Marke steht im Parameter-JSON.** `raw.api_antwort` hat keine
  `marke_key`-Spalte (die Tabelle stammt aus der LINA-Zeit mit einem
  Mandanten); der Worker legt sie als `parameter->>'markeKey'` ab.

**Der Backfill-Schalter bleibt** — er ist jetzt aber nur noch die Abkürzung,
wenn man den Durchstich sofort will, statt auf den nächsten Sync-Lauf zu
warten. Solange nie Inventuren geholt wurden, IST die letzte Seite die
erste: der laufende Abgleich stößt dieselbe Kette an (Seite 1 reiht alle
Folgeseiten ein, jede geladene Seite reiht ihre Positionen nach).

**Was weiterhin gilt:** Belastbar ist die Schwundrechnung praktisch nur bei
Wilma Wunder. Der laufende Abgleich holt jetzt alle vier Marken — das kostet
vier Aufrufe je Sync-Lauf, was gegenüber den Bestellungen (ein Aufruf je
Kostenstelle, also 152) nicht ins Gewicht fällt.

## Vergleichsgruppen: zwei Dashboards, kein Umschalter, kein zweiter Filter (10.08.2026)

**Anlass.** Angefragt: „ein Dashboard, bei dem man einen Betrieb gegen den Durchschnitt der
Marke vergleicht, und eins, bei dem man einen Betrieb gegen andere Betriebe in der gleichen
Stadt vergleicht … um festzustellen, ob bei allen der Umsatz eingebrochen ist oder nur bei
einem."

### Zwei Seiten, nicht eine mit Umschalter

Marke und Stadt fangen **verschiedene Störquellen** ab: die Marke, was am Konzept liegt
(gleiche Karte, gleiche Preise, über ganz Deutschland verteilt); die Stadt, was am Standort
liegt (gleiches Wetter, gleiche Feiertage, gleiche Kaufkraft, verschiedene Konzepte).

Ein Umschalter hätte Platz gespart und die eigentliche Aussage unmöglich gemacht: **fällt
ein Betrieb gegen beide Gruppen ab, liegt es am Betrieb.** Dafür müssen beide gleichzeitig
sichtbar sein — in zwei Reitern desselben Dashboards wäre es dasselbe Problem.

### Die Vergleichsgruppe wird aus dem Betrieb abgeleitet, nicht eingestellt

Beide Seiten tragen nur **Monat** und **Betrieb** als Filter. Ein zweiter Filter „Marke"
bzw. „Stadt" wäre naheliegend und falsch: zwei Filter, die dieselbe Menge einschränken,
können einander widersprechen („Betrieb = Aposto Mainz" und „Marke = Enchilada"), und
Metabase antwortet darauf mit einer **leeren Seite ohne Fehlermeldung**. Das ist genau die
Falle, wegen der die Textfilter am 26.07.2026 überhaupt Auswahllisten bekommen haben — ein
leeres Dashboard ist von einem Betrieb ohne Geschäft nicht zu unterscheiden.

### Kein Zeitraumfilter, sondern ein Fenster am Monatsfilter

Die Verlaufskarten lesen **zwei verschiedene Tabellen** — der Betrieb aus `mart.umsatz_ytd`,
die Gruppe aus `mart.konzept_schnitt_monat` bzw. `mart.stadt_schnitt_monat`. Ein
Metabase-Feldfilter baut seine Klausel aus dem *Tabellennamen* und hätte deshalb nur einen
der beiden Äste eingeschränkt: die Linien wären still verschieden lang geworden, ohne
Fehlermeldung. Stattdessen ein festes Fenster von 24 Monaten, das am Monatsfilter hängt —
zwei Jahre, weil ein Vorjahresvergleich mindestens einen vollen Saisonzyklus braucht.

### Die Richtung gehört in die Sicht, nicht in den Kopf des Lesers

Bei Umsatz und Bewertung ist mehr besser, bei Personal und Wareneinsatz weniger. Eine Spalte
„Abweichung: +3,2" ist ohne diese Angabe zweideutig — und zwar auf die gefährliche Art, weil
sie entschieden aussieht. `mart.marke_vergleich` und `mart.stadt_vergleich` tragen deshalb
eine Spalte `vergleich` mit *besser* / *schlechter* / *gleich*, abgeleitet aus
`ampel.regel.richtung` des Standardregelwerks. Die Karten beschriften sie nur noch.

Dieselbe Überlegung wie bei `mart.konzept_schnitt_monat` (Migration `0013`): eine
Rechenvorschrift, die in mehreren Karten nachgebaut wird, zerfällt bei der ersten Korrektur.

### Die Stadt kommt aus `manual.betrieb_standort`, nicht aus `core.betrieb.stadt`

`core.betrieb.stadt` ist bei allen 141 Betrieben NULL und wird trotzdem durch ein Dutzend
`mart`-Sichten durchgereicht. Eine Stadtauswertung darauf hätte **eine** Gruppe namens NULL
mit allen Betrieben darin ergeben — kein Fehler, kein leeres Ergebnis, nur eine falsche
Zahl. Deshalb tragen die beiden verlockendsten dieser Spalten seit Migration `0049` einen
Spaltenkommentar, den Metabase im Datenmodell anzeigt.

**Verworfen: die Stadt aus dem Betriebsnamen ableiten.** Dieselbe Begründung wie bei der
Karte in `0008` — „Alter Kranen GmbH" trägt keine Stadt, und fünf Betriebe heißen nach
derselben Stadt, ohne dieselbe zu sein. Eine falsche Vergleichsgruppe ist schlimmer als eine
fehlende: sie wird nicht hinterfragt.

### Ohne Auswahl zeigen Tabellen alles, Diagramme die Gruppen

Zwei SQL-Muster, bewusst unterschiedlich: `WHERE 1 = 1 [[AND betrieb = {{betrieb}}]]` liefert
ohne Auswahl alle Zeilen (Tabellen), `WHERE false [[OR betrieb = {{betrieb}}]]` keine
(Diagramme). 49 Linien übereinander sind keine Kurve; die Diagramme zeigen ohne Auswahl
deshalb die Gruppen selbst. Damit ist **jede** der zehn Karten in beiden Zuständen eine
Aussage, und keine muss mit „bitte oben etwas auswählen" leer bleiben.

### Nachtrag am selben Tag: die kurze Fassung gehört aufs Betriebsblatt

Rückfrage nach dem Bau von ⑨ und ⑩: „oder vielleicht sogar das bestehende
Betriebs-Dashboard um diese zwei Sachen erweitern … alles auf einem Dashboard". Richtig —
die Frage „liegt es an diesem Betrieb?" stellt sich beim Lesen des Betriebsblatts, nicht auf
einer Seite, zu der man erst navigieren muss. Zwei Karten mehr auf ③ Betrieb, direkt unter
den sechs Kennzahlen: beide Maßstäbe nebeneinander in einer Tabelle, und ein Verlauf mit
Betrieb, Marke und Stadt in einem Bild.

**⑨ und ⑩ bleiben trotzdem.** Sie zeigen die Nachbarbetriebe **einzeln** — vier Zeilen für
Karlsruhe, achtzehn für Enchilada, dazu Verläufe je Betrieb. Das passt nicht auf ein
Betriebsblatt, das schon sechs Reiter hat. Die Aufteilung ist damit die übliche dieses
Projekts: die verdichtete Aussage dort, wo die Frage entsteht, die Auflösung einen Klick
weiter. Neu ist, dass die beiden Seiten seit diesem Nachtrag überhaupt angeklickt erreichbar
sind — über die Spalten „Marke (Median)" und „Stadt (Median)".

**Verworfen: die vier Spalten an `dd_betrieb_kopf` anhängen.** Das wäre die kompakteste
Lösung gewesen und die schlechteste: dreizehn Spalten erzwingen waagerechtes Scrollen, und
genau daran ist diese Tabelle am 28.07.2026 schon einmal gescheitert. Zwei Karten
untereinander in derselben Zeilenreihenfolge lesen sich besser als eine, die man schieben
muss.

**Verworfen: Δ-Spalten auf ③.** Auf dem Betriebsblatt stehen Median und Rang, aber kein
Abstand. Der Rang trägt die Aussage ohne Zweideutigkeit — „16 von 17" heißt schlecht,
gleichgültig ob bei der Kennzahl mehr oder weniger besser ist. Ein „+5,8" heißt das nicht.
Wer den Abstand in Zahlen braucht, ist einen Klick entfernt.

---

## Personenbezogene Daten: die Sperre fällt (11.08.2026)

*Entschieden von Eugene, ausgelöst durch die Round-Table-Map des Managements.*

**Die Regel ist aufgehoben.** Personenbezug ist ab sofort **kein Grund mehr**, eine Quelle
nicht zu holen. Der Maßstab ist jetzt einer: **dient das Feld einer Kennzahl aus der
Round-Table-Map?** Wenn ja, wird es geholt.

### Woher die Regel kam — und warum sie fiel

Sie stand an sieben Stellen, aber sie war **nie eine Vorgabe des Fachbereichs**. Sie ist in
Phase 1 im Projekt selbst entstanden, als es noch keinen definierten Auswertungszweck gab:
`datensicherung.md` Klasse D, `yext-anbindung.md` §3, die Lieferanten-Whitelist in
Migration `0002`, der Kommentar an `mart.pruefung_bon` in `0006`, zwei Stellen im
API-Inventar und die ausgeschlossene `USER_NAME`-Dimension im Yext-Analytics-Inventar. Die
Begründung war überall dieselbe: *„für die Kennzahl nicht nötig"*.

**Genau diese Begründung ist mit der Round-Table-Map hinfällig geworden.** Sie definiert den
Zweck, den es vorher nicht gab, und mehrere ihrer Kennzahlen sind ohne Personenbezug nicht
rechenbar:

| Kapitel der Map | Kennzahl | braucht |
|---|---|---|
| 5.1 | Bons mit Aktion, Ø Bon mit vs. ohne Aktion, Gäste mit Aktion | Bonebene aus dem Kassenjournal |
| 4.2 | Kurswirkung: Kursabschluss ↔ Durchschnittsbon, Zusatzverkäufe | Zuordnung **je Mitarbeiter**, sonst nur ein schwacher Betriebsvergleich |
| 2.1 / 2.3 / 7.2 | PK je Umsatzstunde, Stunden je Zeitzone, Plan vs. Ist | Arbeitszeiten je Person und Schicht |
| 7.2 / 11.1 | Wartezeiten | Bon-Zeitstempel |
| 3.1 | Antwortverhalten je Bearbeiter | Yext-`USER_NAME` |

Die frühere Fassung hat das eine Mal ausdrücklich offengelassen: *„Falls doch: erst Zweck
definieren, dann holen."* Der Zweck ist jetzt definiert. Das ist keine Kehrtwende, sondern
der vorgesehene Ausgang.

**Ein Vorlauf gab es schon.** Am 03.08.2026 fiel derselbe Grundsatz bereits für die
Bewertungstexte und den Autorennamen (`core.bewertung`, Migrationen `0037`/`0038`) — mit
derselben Begründung: eine Zahl sagt *dass*, erst der Text sagt *woran*. Diese Entscheidung
zieht die Linie nur konsequent zu Ende, statt sie Fall für Fall neu zu verhandeln.

### Was ausgeschlossen bleibt — und aus welchem anderen Grund

Zwei Dinge bleiben draußen, und **keines davon wegen Personenbezugs**:

1. **Zugangsdaten.** `db_name`, `db_user`, `db_pass` aus `getStoreData`, dazu IBAN, BIC und
   Steuernummer. Das fällt unter Regel 2 in `AGENTS.md` — Zugangsdaten werden nicht
   gespeichert, egal von wem. Unverändert gültig.
2. **Steuer- und Bankdaten der Lieferanten** (`ustid`, `hrb`, `kreditor`, `gegenkonto*`).
   Sie beantworten keine Kennzahl. Die Whitelist in `src/transform/index.ts` und die beiden
   Tests bleiben deshalb stehen — aber als *fachliche* Entscheidung, die eine Kennzahl
   jederzeit umstoßen kann, nicht als Grundsatz.

### Was sich dadurch **nicht** ändert

Die Aufhebung betrifft ausschließlich die Frage *welche Felder*. Alle übrigen harten Regeln
gelten unverändert: in LINA wird nur gelesen (1), Zugangsdaten kommen aus Umgebungsvariablen
(2), die Drosselung bleibt (3), der Raw-Layer bleibt append-only (4).

**Und die Daten sind damit noch nicht da.** Wer diesen Abschnitt liest und annimmt, die
Bonebene liege jetzt vor, irrt. Drei Hindernisse standen neben dem Personenbezug und stehen
noch:

- **Rechte.** Berichte 107, 118, 23, 8, 7, 9, 24 liefern HTTP 500. Mitarbeiter-Stammdaten
  stehen auf `access: false`. Das klärt Concept Family, nicht der Importer.
- **Format.** Kassenjournal und Stundenzettel sind vermutlich HTML, nicht JSON. Ungemessen.
- **Kosten.** Betriebs-Reports kosten 141 Aufrufe je Zeitraum statt einem. Bericht 107 über
  fünf Jahre sind rund 8.500 Anfragen — bei der geltenden Drosselung eine Planungsgröße.

Nächster Schritt ist deshalb **messen, nicht bauen**: je ein lesender Aufruf auf
`/finanzen/report/kassenjournal` und auf Bericht 107 in Betriebskontext, um Format, Umfang
und Rechtelage zu kennen. Vorher lässt sich der Aufwand für Kapitel 2, 4.2, 5.1 und 7.2 der
Map nicht seriös schätzen.

### Wo die Regel überall stand

Aktualisiert wurden `datensicherung.md` (Klasse D), `datenherkunft.md` (zwei Stellen),
`yext-anbindung.md` §3, `lina-api-inventar-1b.md`, `lina-api-inventar-1c.md` und
`yext-analytics-inventar.md`. **Die Kommentare in den Migrationen `0002`, `0006`, `0036` und
`0037` bleiben unangetastet** — sie sind angewandte Migrationen und dokumentieren, was zum
damaligen Zeitpunkt galt. Wer sie liest, findet den Widerspruch über diesen Abschnitt
aufgelöst; sie nachträglich umzuschreiben würde die Historie verfälschen und wäre bei
`0002` und `0006` auch wirkungslos, weil dort nur Quelltextkommentare stehen.

---

## 11.08.2026 — Entscheidungen aus dem Nachmessen der Round-Table-Lücken

Anlass: Für die Round-Table-Map standen Punkte als offene Anfragen im Raum, die nie
gemessen worden waren. Messreihe und Zahlen in
[`befunde-datenlage.md`](befunde-datenlage.md).

### Marktindex kommt von Eurostat, nicht von Genesis

*Vorgabe war Destatis Genesis, Tabelle 45213.* Der Genesis-REST-Dienst verlangt seit dem
Wegfall des Gastzugangs eine Registrierung; ein Aufruf ohne Anmeldung liefert eine
HTML-Seite statt Daten (geprüft 11.08.2026, `logincheck` und `find` beide HTML).

**Entschieden: Eurostat `sts_setu_m`, NACE I56 (Gastronomie), Deutschland, monatlich,
kalenderbereinigt.** Quelldaten sind die des Statistischen Bundesamtes — Eurostat ist der
Verteilweg, nicht eine zweite Messung. 101 Monate ab 2018-01, offen abrufbar, tagesaktuell
gepflegt.

**Beide Reihen werden geführt** (`index_nominal` und `index_real`), weil die Entscheidung
real gegen nominal noch aussteht und sie das Vorzeichen dreht. Der Vergleichsmaßstab in
`mart.markt_vergleich.delta_pp` ist **nominal**, weil unsere Umsätze nominal sind.

Wenn Concept Family später einen Genesis-Zugang stellt: `manual.marktindex` bleibt, nur die
Spalte `quelle` ändert sich. Die Sicht darüber merkt nichts davon.

### Bundesland über die PLZ, nicht über den Ortsnamen

`manual.betrieb_standort` führt für 60 Betriebe eine gepflegte PLZ. Die 44 verschiedenen PLZ
sind einzeln gegen `api.zippopotam.us` aufgelöst worden, das je PLZ Ort, Bundesland **und**
Koordinaten liefert — die Koordinaten dienten als Gegenprobe gegen die bereits gepflegten.

**Nicht über den Ortsnamen**, aus demselben Grund wie in Migration `0008`: fünf Betriebe
heißen nach derselben Stadt, und „Alter Kranen GmbH" trägt gar keinen Ort im Namen.

Feiertage stammten bis zum 20.08.2026 aus **zwei** Quellen: `openholidaysapi.org` reicht bei
den gesetzlichen Feiertagen nicht vor 2020 zurück, unsere Umsatzhistorie beginnt 2018, und für
2018/2019 kamen sie deshalb von `feiertage-api.de`. **Diese zweite Quelle ist mit `0089`
entfallen** — sie führte vier nicht landesweite Tage als Feiertage (BW Reformationstag, BY
Buß- und Bettag, SN und TH Fronleichnam) und schrieb vier weitere anders. Der Preis steht in
`0089` und ist bewusst bezahlt: **2018 und 2019 haben keine Feiertage.** Ab wann ein Land
Termine hat, sagt `mart.kalender_abdeckung`; `mart.kalender_zeitraum` (0085) beginnt ohnehin
rollierend erst drei volle Jahre vor heute.

### Eigene Zeitfenster ersetzen LINAs Zonen nicht, sie stehen daneben

LINAs Zonen brechen bei 11:30 und 17:30. Aus Stundenwerten ist das nicht nachbaubar, und der
Fehler ist nicht klein: Mittagszeit 11:30–14:00 gegen 11–14 sind +8,4 %, gegen 12–14 −8,4 %.

**Entschieden: `mart.umsatz_zeitfenster` als eigene Sicht, `core.zeitzonenbericht_zone`
bleibt unangetastet.** Die Fenstergrenzen stehen in `manual.zeitfenster` als Stammdaten und
nicht als `CASE` in einer Sicht — sie sind eine fachliche Festlegung, die sich ändern wird.
Die sieben eingetragenen Fenster sind ausdrücklich ein **Vorschlag**, kein Befund.

### Aktionsartikel werden NICHT aus den Verkaufsdaten geraten

Der Versuch war messbar, weil LINA den Aktionsumsatz je Betrieb und Tag liefert. Gegen diese
bekannte Summe trafen die Kandidatenlisten auf 104 %, 358 % und 61 %.

**Entschieden: keine automatische Zuordnung.** Eine Spanne von −39 % bis +258 % ist als
Grundlage für Deckungsbeitrag je Aktion und Kannibalisierungsrechnung unbrauchbar, und eine
falsche Zuordnung meldet sich nie wieder — sie fährt in jeder Folgeauswertung mit.

Die Kandidatenlisten werden trotzdem übergeben: sie verkürzen Concept Familys Arbeit auf
Bestätigen statt Suchen. Ausgewiesen als **unsicher**, nicht als Ergebnis.

### Bericht 107 ist für Kapitel 2.1 nicht mehr nötig

`core.personalkosten.eff_*` ist Umsatz je Arbeitsstunde; die Stunden fallen durch Division
heraus, und die Bereichszuordnung schließt als Identität (Median 0,99995 über 16.110
Betriebstage). Gegenprobe gegen die BWA: impliziter Stundenlohn 21,12 € im Median, 97,7 %
der 838 Betriebsmonate im Band 14–32 €/h.

**Entschieden: Kapitel 2.1 wird auf `eff_*` gebaut**, nicht auf eine Freigabe gewartet.
Bericht 107 bleibt als Messaufruf (`bun run lina-fragen d2`) auf der Liste — er würde die
Rückrechnung ersetzen und zusätzlich Schichtebene liefern, aber er blockiert nichts mehr.

### Messaufrufe bekommen einen eigenen Befehl statt einer Anleitung

Sechs Fragen im Dokument waren mit je einem lesenden Aufruf entscheidbar, aber niemand hatte
sie gestellt. Der Grund war Reibung: `AGENTS.md` Regel 7a verbietet den Sync aus der
Agentenumgebung, und eine Anleitung in Prosa wird nicht ausgeführt.

**Entschieden: `bun run lina-fragen <id>`** (`src/messen.ts`). Ein Request, keine Schreibvorgänge
— weder in LINA noch in die eigene Datenbank —, dieselbe Drosselung und dieselbe
Anmelde-Notbremse wie im Sync. Jede Messung nennt **vor** dem Aufruf, welche Antwort welche
Schlussfolgerung erlaubt; wer den Schluss erst nach dem Ergebnis formuliert, findet immer
einen.

Die Endpunkte stehen bewusst **nicht** in `ENDPUNKTE` — was dort steht, reiht der Sync
automatisch ein, und genau das soll bei einer einmaligen Messung nicht passieren.

### FoodNotify Stufe 2 und der Inventur-Import bleiben Handarbeit des Nutzers

Beide sind gebaut und ungestartet. Sie **konnten in dieser Sitzung nicht gestartet werden**:
`bun run sync` füllt die Warteschlange für beide Quellsysteme und arbeitet sie in einem
Prozess ab — der LINA-Anteil würde eine Anmeldung aus der Agentenumgebung auslösen, also
genau das, was Regel 7a verbietet und Regel 7 als teuersten möglichen Fehler benennt.

**Entschieden: nicht gestartet, stattdessen die Obergrenze gemessen.** Der PLU-Join gilt nur
bei `kassensystem = 'amadeus'` — 42 Kostenstellen in 21 Betrieben mit 33,9 % des Umsatzes
2026, davon 31 bei Wilma Wunder. Das ist genau die Marke, deren `fixer_we`-Abdeckung bei
6,7 % liegt: die beiden Wege zum Soll-Wareneinsatz überschneiden sich kaum, sie ergänzen
sich auf zusammen rund 63 % des Umsatzes.

Wer es startet, braucht zwei Läufe im eigenen Terminal:
`bun run einreihen --foodnotify` und `bun run einreihen --foodnotify-inventuren`, danach
`bun run sync`.

---

## 11.08.2026, abends — Entscheidungen für den Ladenakte-Import

Grundlage sind die Messungen in [`ladenakte-messungen.md`](ladenakte-messungen.md). Jede
dieser Entscheidungen hat eine Messung hinter sich; keine ist aus Plausibilität getroffen.

### Es wird nicht geblättert — ein Aufruf holt einen ganzen Ordner

Der Plan sah 3.366 Seitenaufrufe zu je 200 Zeilen vor. Die Messung zeigt: die Belegliste
kennt **keine Seitengrenze**. `length=10000` liefert alle 8.384 Eingangsrechnungen von
Enchilada Karlsruhe in einer Antwort — 8,22 MB in 11,9 s, aufsteigend nach ID.

**Entschieden: ein Aufruf je (Betrieb, Belegart).** 621 nicht-leere Paare statt 3.366
Seiten, Laufzeit von rund 4,9 auf **1,3 Stunden**.

Der eigentliche Gewinn ist aber nicht die Zeit, sondern was wegfällt. Blättern über Stunden
heisst: während des Laufs lädt jemand einen Beleg hoch, das Seitenraster verschiebt sich um
eine Position, und der Abzug bekommt eine **Lücke** — nicht bloss eine Dublette. Genau das
liesse sich hinterher nicht einmal bemerken. Ein Ordner in einem Aufruf ist entweder ganz
da oder gar nicht, und `recordsTotal` sagt, welches von beidem.

**Preis:** bis zu 12,4 MB je Antwort (Aposto Mainz, 12.639 Kassenbelege) und rund 582 MB
Rohdaten insgesamt. `ANFRAGE_TIMEOUT_MS` steht auf 60.000 und trägt die geschätzten 18 s
im schlechtesten Fall. Beides ist bezahlbar; die Lücke wäre es nicht.

**Bedingung:** der Lader prüft `data.length === recordsTotal` und scheitert laut bei
Abweichung. Ohne diese Prüfung sieht eine gekürzte Antwort aus wie ein kleiner Ordner.

### BWA-Zeilen werden über ihre Nummer verbunden, nie über die Beschriftung

Im Longterm-HTML trägt jede Datenzeile im Diagramm-Link eine Nummer (`/img/82/` = Erlöse
Getränke). Gemessen an zwei sehr verschiedenen Betrieben: **77 Datenzeilen, Nummern 82–162,
eindeutig, identisch.** Und dieselben 77 Nummern führt die Plan-BWA im Stammdatenblatt in
einer eigenen Spalte.

**Entschieden: `bwa_zeile_id` ist der Schlüssel.** Plan und Ist joinen darüber.

Die Alternative wäre der Vergleich der Beschriftungen gewesen, und der wäre brüchig: sie
sind teils abgeschnitten („Freiwillige soz. Auf", „Abschluss-/Pruefungsk"), tragen Umlaute
und ändern sich mit jeder Textpflege in LINA. Ein Join über Text hätte funktioniert, bis
ihn jemand still kaputtmacht — und das wäre nicht aufgefallen, weil ein nicht getroffener
Join keine Fehlermeldung ist, sondern eine leere Zeile.

Die Nummer trennt zusätzlich Daten von Layout: die 26 Zeilen ohne Nummer sind
Gliederungslücken. Kein Ratespiel, welche Zeile eine Summe ist.

### Ein eigener Parser statt einer neuen Abhängigkeit

Das Merkblatt hielt einen Regex-Parser für „nicht seriös baubar" und schlug `HTMLRewriter`
oder `linkedom` vor. Das echte HTML widerlegt die Annahme: die Tabelle ist serverseitig
gerendert, flach, ohne Verschachtelung in den Zellen ausser einem `<a>`.

**Entschieden: ein kleiner eigener Parser, keine neue Abhängigkeit.** Das Projekt hängt
heute an `pg`, `tslog` und `zod` — eine Parse-Bibliothek für zwei Tabellenformen wäre
teurer als der Parser selbst.

**Was ihn trägt, ist nicht die Regex, sondern die Prüfung dahinter:** genau 77 Zeilen mit
Nummer, alle Nummern eindeutig, jede Datenzeile so viele Zellen wie die Kopfzeile Monate
hat. Ändert LINA das Markup, schlägt eine dieser Prüfungen fehl und der Posten scheitert
laut. Ein Parser ohne diese Prüfungen wäre tatsächlich unseriös — mit ihnen ist er
belastbarer als eine Bibliothek, die alles klaglos irgendwie liest.

### Die Antwortform steht im Register, nicht im Content-Type

LINA deklariert `/intranet/ladenakte/baum/...` als `text/html` und liefert sauberes JSON.
Wer am Header entscheidet, parst dort das Falsche.

**Entschieden: `Endpunkt.form: 'json' | 'html'`, Vorgabe `json`.** Die Form ist eine
Eigenschaft des Endpunkts und aus der Messung bekannt — also gehört sie dorthin, wo alles
andere über den Endpunkt steht.

**Nicht** mitentschieden wurde ein Dokument-Header: die HTML-liefernden Ladenakte-Seiten
werden von LINAs eigener Oberfläche ebenfalls per XHR nachgeladen. Ein Navigations-Header
wäre hier die unstimmige Variante und würde Regel 8 verletzen, nicht erfüllen.

### Zwei Notbremsen werden für HTML enger gefasst — und nur für HTML

`sessionAbgelaufen()` hielt bisher jede HTML-Antwort mit `name="password"` für die
Loginseite. Das Stammdatenblatt trägt Formulare. Die Folge wäre eine grundlos ausgelöste
Neuanmeldung gewesen — bei einem Zugang, den es genau einmal gibt und der sich sperren
lässt (Regel 7), der teuerste denkbare Fehlalarm. Für `form: 'html'` gilt jetzt die
Signatur der Loginseite selbst (`dologin`, `window.secret`), die auf keiner Fachseite steht.

`nachAbwehrseiteAussehend()` sucht unter anderem „Zugriff verweigert". In einer deutschen
Fachanwendung ist das gewöhnlicher Seitentext, und ein Treffer beendet nicht den Posten,
sondern den **ganzen Lauf**. Für `form: 'html'` bleiben nur Zeichenketten, die kein
Fachtext enthält: `captcha`, `cloudflare`, `attention required`, `too many requests`.

**Für JSON ändert sich nichts.** Beide Verschärfungen gelten ausschliesslich für Endpunkte,
die ausdrücklich als HTML deklariert sind — die bestehenden Endpunkte verhalten sich
unverändert.

### Das Stammdatenblatt wird nicht roh abgelegt

Tabelle 5 des Stammdatenblatts führt die vergebenen **API-Schlüssel im Klartext**, mit
IP-Bindung und Scopes. `raw.api_antwort` ist append-only (Regel 4) — was dort landet, ist
nicht mehr zu entfernen, ohne die Versicherung des Projekts anzufassen.

**Entschieden: von dieser einen Quelle wird die Schlüsseltabelle vor dem Ablegen entfernt.**
Der Parser liest ausserdem über eine **Positivliste** genau drei Kopfzeilen (Kapazität,
Plan-BWA, Tagesbudget) — nicht über eine Ausschlussliste. Eine Ausschlussliste vergisst man
bei der nächsten neuen Tabelle; eine Positivliste übersieht sie höchstens.

Beim Anlegen des Test-Fixtures ist genau dieser Fehler passiert und vor dem Commit
korrigiert worden: die Schlüssel lagen im Klartext in `ladenakte_stammdaten.html`. Die
Datei ist jetzt geschwärzt, die Struktur vollständig erhalten. Die beiden Schlüssel gehören
trotzdem rotiert — vermerkt in [`offene-punkte.md`](offene-punkte.md).

### LINA wird nicht angefragt — HTML-Parsen ist die Antwort, nicht der Notbehelf

Die Erhebung hat eine offizielle Drittanbieter-Schnittstelle zutage gefördert, mit Scopes,
die genau passen (`BWAs und SuSas lesen`, `Journaldaten Kasse lesen`). Der technisch
sauberste Weg wäre ein eigener Schlüssel gewesen: keine Anmeldung, kein Scraping, kein
Regel-7a-Problem.

**Entschieden am 11.08.2026 von Eugene: LINA wird aus politischen Gründen nicht
kontaktiert.** Das ist keine offene Frage und keine Aufgabe, die noch jemand erledigen
müsste — es ist eine Festlegung.

Für den Bau heisst das zweierlei. Erstens: **HTML-Parsen ist der gewählte Weg**, nicht die
Zwischenlösung, bis etwas Besseres kommt. Der Parser wird entsprechend gebaut — über
stabile Zeilennummern statt Beschriftungen, mit Strukturprüfungen, die laut scheitern.
Wer ihn später anfasst, soll ihn als dauerhafte Einrichtung behandeln.

Zweitens: **Regel 7a bleibt dauerhaft.** Die Anmeldung aus der Agentenumgebung wird
abgewiesen, und daran wird sich nichts ändern, weil niemand LINA darum bitten wird. Das ist
keine vorübergehende Unbequemlichkeit, sondern die Betriebsform.

**Praktisch heisst das aber nicht, dass jemand etwas startet.** Der Container fährt einen
Zeitplan (`bun run sync`), und `nachfuellen()` läuft darin als Vorlauf. Wer neue Arbeit
dorthin einhängt, hängt sie in etwas ein, das ohnehin läuft — deshalb bekommt der
Ladenakte-Import **kein** `einreihen`-Handkommando, sondern ein `ladenakteNachfuellen()`
neben `linaNachfuellen()` und `foodnotifyNachfuellen()`.

Das ist zugleich die Lehre vom 02.08.2026: ein zweiter Zeitplan (`einreihen --taeglich`)
fiel aus, der erste meldete weiter „ok", und LINA stand acht Tage still, ohne dass es
auffiel. Ein Importer ohne Arbeit sieht aus wie einer, der fertig ist. **Ein Zeitplan, ein
Ausfallpunkt** — und einmalige Massenaktionen als Handbefehl sind genau das, was diese
Regel vermeiden will, sobald die Aktion sich wiederholen kann.

Dieselbe Festlegung gilt für alle benachbarten Versuchungen: gesperrte Berichte
freischalten lassen, Rechte erweitern, den Bericht 107 doch noch erbitten. Wo eine Lücke
nur mit LINAs Mitwirkung zu schliessen wäre, wird sie **gemessen und dokumentiert**, nicht
eskaliert. Nicht betroffen ist Selbstbedienung in der Oberfläche — einen API-Schlüssel im
Stammdatenblatt selbst zu löschen und neu anzulegen ist kein Kontakt.

---

## 12.08.2026 — Entscheidungen aus der Lieferantenfreigabe

**Anlass.** Die Erhebung „GFGH Q2 2026.xlsx" (Getränkefachgroßhandel je Betrieb, 79
Produktpreise) kam fast leer zurück. Nachgemessen am 12.08.2026: 88 Betriebsspalten, davon
**44 ganz ohne jede Angabe**; ein GFGH-Name bei 14 von 88; **607 von 6.952 Preiszellen
gefüllt, also 8,7 %**. *Eugene:* nicht nachfordern, sondern aus den Rechnungen ableiten.
Daraus Migration `0055`. Tabellen und Sichten stehen in [`datenmodell.md`](datenmodell.md),
die Messreihe in [`befunde-datenlage.md`](befunde-datenlage.md), die Nacharbeiten in
[`offene-punkte.md`](offene-punkte.md).

### Drei Zustände statt zwei — eine fehlende Zeile ist kein Urteil

Die tragende Entscheidung dieser Arbeit. Was in `manual.lieferant_freigabe` **nicht** steht,
heißt „nicht eingeordnet" und niemals „nicht freigegeben".

| Zustand | Woran erkennbar | Was er aussagt |
|---|---|---|
| freigegeben | Zeile mit `freigegeben = true` | Einkauf dort ist gewollt |
| gesperrt | Zeile mit `freigegeben = false` bzw. GFGH-Befund | Fremdeinkauf — ein Befund |
| nicht eingeordnet | keine Zeile | niemand hat hingesehen — **kein** Urteil |

**Verworfene Alternative: ein Standardwert.** Ein `DEFAULT false` oder ein
`COALESCE(…, false)` in der Sicht wäre eine Zeile Code gewesen und hätte die Auswertung
sofort vollständig aussehen lassen. Nachgemessen am 12.08.2026 hätte er allein in den
letzten zwölf Monaten **71 Firmen mit 1.175.609 EUR** (8,8 % des FoodNotify-Volumens) zu
Fremdeinkauf erklärt — darunter Brauereien mit Liefervertrag (Dinkelacker Stuttgart,
Höpfner Karlsruhe, Auerbräu Rosenheim) und rund ein Dutzend Winzer. Zum Vergleich die
eingeordnete Seite: 12.245.117 EUR über 51 Betriebe bei 7 Lieferanten.

**Warum das mehr ist als eine saubere Modellierung.** Eine Verdachtsliste, auf der ein
Dutzend offensichtlicher Vertragspartner steht, wird beim ersten Lesen als kaputt eingestuft
— und danach werden auch die echten Befunde darin nicht mehr gelesen. Der Standardwert
hätte den Aufwand nicht gespart, sondern nur unsichtbar gemacht: Statt einer Arbeitsliste
mit 71 offenen Zeilen gäbe es 71 stille Falschaussagen. Dasselbe Muster wie bei
`core.bwa_buchungsstand` am 26.07.2026 („hat geliefert / nie gebucht / nie geprüft"), nur
diesmal von Anfang an mit drei Zuständen statt als Korrektur hinterher.

**Was der dritte Zustand kostet, ehrlich benannt.** Die Sicht beantwortet heute nicht „wo
kaufen wir am Vertrag vorbei", sondern „hier ist noch nichts entschieden". Nachgemessen am
12.08.2026 trägt **keine einzige der 9.078 Zeilen** in `mart.fremdeinkauf` über die gesamte
Historie die Einordnung „nicht freigegeben" — die Verdachtsliste ist am Tag des Commits
leer. Das ist die Kehrseite derselben Entscheidung und kein Fehler in ihr: Die Zahl der
offenen Zeilen ist die Fortschrittsanzeige, sie schrumpft, während jemand die Liste
abarbeitet. Größter offener Posten ist Transgourmet mit 2,65 Mio. EUR — letzter Beleg
Januar 2025, vermutlich abgelöst, also genau die Art Zeile, die ein Standardwert als Befund
ausgegeben hätte.

### Der Getränkefachgroßhandel hängt am Betrieb, nicht am Konzern

Bei Food, Nonfood und Kaffee/Tee gibt es Konzernlieferanten, und eine Freigabe gilt für alle
Betriebe. Beim GFGH ist es je Betrieb ein anderer, weil Getränkelogistik regional ist. Deshalb
zwei Tabellen: `manual.lieferant_freigabe` konzernweit je Warengruppe,
`manual.gfgh_betrieb` je `betrieb_key`.

**Verworfen: eine Tabelle mit einer zusätzlichen Warengruppe `'getraenke'`.** Das wäre die
kompaktere Lösung gewesen und die falsche — eine konzernweite Getränkefreigabe ist eine
Aussage, die es nicht gibt. Sie hätte den GFGH eines einzelnen Betriebs für alle 141
freigegeben und damit genau den Befund gelöscht, den die Erhebung finden sollte.
`CHECK warengruppe IN ('food','nonfood','kaffee_tee','sonstiges')` sperrt das. **Warum ein
CHECK und kein Kommentar:** Ein Kommentar hält niemanden auf, der in zwei Jahren „schnell
noch die Getränke" nachträgt; ein CHECK schon, und zwar laut und beim `INSERT`.

`gebunden` und `verraeumt` sind aus demselben Grund wie oben **dreiwertig** — `NULL` heißt
„nicht beantwortet" und ist bei 44 der 88 Spalten der Fall, nicht „nein".

### Der Betrieb wird über seinen Namen aufgelöst, nicht über eine getippte Schlüsselzahl

Eine von Hand in die Saat geschriebene `betrieb_key`-Zahl lädt auch dann klaglos, wenn sie
auf den falschen Betrieb zeigt — der Fehler ist nicht sichtbar, weil das Ergebnis plausibel
bleibt. Ein Name ist gegen `core.betrieb` prüfbar. Deshalb steht in den `VALUES` der Name.

**Nachgemessen am 12.08.2026: die Absicherung, auf die sich die Saat beruft, gibt es nicht.**
Der Kommentar in `0055` verspricht, ein nicht mehr existierender Name „liefert NULL und
bricht am NOT NULL des Primaerschluessels laut ab". Tatsächlich steht dort ein
`JOIN core.betrieb b ON b.name = v.betrieb`, und ein INNER JOIN lässt die Zeile still
fallen: 14 VALUES-Zeilen mit einem absichtlich falschen Namen ergeben 13 Treffer, keinen
Fehler, keine Meldung. **Die Entscheidung bleibt richtig, ihre Umsetzung trägt sie nicht** —
bei einer Umbenennung fehlt der GFGH lautlos, und `mart.fremdeinkauf` ordnet dessen Getränke
dauerhaft als „nicht eingeordnet" ein, also in den Zustand, der wie Arbeit aussieht und
keine ist.

**Behoben am 12.08.2026, noch vor dem Commit.** `0055` war zu diesem Zeitpunkt zwar auf
`localhost/lina` angewendet, aber nirgends committet — deshalb wurde die Datei selbst
korrigiert statt eine Folgemigration nachzuschieben: `LEFT JOIN core.betrieb`, damit ein
unbekannter Name `NULL` liefert und am `NOT NULL` des Primärschlüssels tatsächlich
abbricht. Der Kommentar beschreibt jetzt, was der Code tut. Die lokale Datenbank wurde dafür
zurückgebaut und die Migration neu abgespielt; auf Hetzner läuft sie ohnehin erstmalig.

Der Fall ist trotzdem hier festgehalten, weil die *Fehlerart* wiederkommt: eine Begründung,
die eine technische Absicherung behauptet, die niemand nachgemessen hat. Aufgefallen ist sie
nur, weil ein Prüflauf die Behauptung gegen die Datenbank gehalten hat.

### Zusammengeführt wird nur, wo es eine Firma ist — und der Schlüssel wird gerechnet

Die vier FoodNotify-Mandanten führen Distra als vier getrennte Lieferanten. Zusammengeführt
ist es **einer**: 22.475.163 EUR über 56 Betriebe. Ohne die Zusammenführung steht der
größte Lieferant des Konzerns viermal klein in der Liste statt einmal groß.

**Die Grenze ist die Firma, nicht die Namensähnlichkeit.** „Trinkkontor" und „Trinkkartell"
bleiben getrennt. Ein ähnlicher Name ist kein Beleg für dieselbe Firma, und eine falsche
Zusammenführung meldet sich nie wieder — sie fährt in jeder Folgeauswertung mit. Dieselbe
Begründung wie bei den Aktionsartikeln am 11.08.2026.

**Verworfen: den normalisierten Schlüssel von Hand in die Saat schreiben.** Er kommt aus
`core.kreditor_name_norm()`, wie überall sonst auch. Ein getippter Schlüssel ist im Moment
des Tippens richtig und nach der ersten Änderung der Normalisierungsfunktion still falsch —
die 18 Zeilen in `manual.kreditor_gruppe` träfen dann ins Leere, ohne dass eine Zeile fehlt.

### FoodNotify und Belegarchiv stehen nebeneinander, sie werden nicht addiert

`mart.fremdeinkauf` trägt eine Spalte `quelle` (`'foodnotify' | 'belegarchiv'`) statt einer
gemeinsamen Summe. Grund: Dieselbe Rechnung steht in **beiden** Quellen, wenn sie über
FoodNotify bestellt und in LINA gebucht wurde. `fn_netto + beleg_netto` wäre eine plausible,
doppelt gezählte Zahl — und die sieht man ihr nicht an.

**Warum das festgelegt wird, bevor es etwas zu addieren gibt.** `core.buchungsbeleg` hat am
12.08.2026 **0 Zeilen**; der Ladenakte-Abzug (1.048 Paare, 621 davon nicht leer, 593.314
Belege in acht Ordnern) reiht sich beim nächsten Sync-Lauf von selbst ein. Genau deshalb
jetzt: Sobald beide Spalten gefüllt sind, sieht ihre Summe richtig aus und niemand rechnet
nach. Eine Trennung, die erst nach dem ersten falschen Bericht eingezogen wird, kommt zu
spät.

**Warum es überhaupt zwei Quellen gibt.** FoodNotify deckt nicht den Konzern ab: 14 der 57
operativen Betriebe haben keine FoodNotify-Daten der letzten zwölf Monate, und diese 14
tragen 30,0 % des operativen Umsatzes — zehn davon sind „Deutsche Konzepte". Der blinde
Fleck ist damit fast eine ganze Marke und kein Streuverlust; Zahlen und Gegenproben in
[`befunde-datenlage.md`](befunde-datenlage.md). Das Belegarchiv ist die einzige Quelle, die
diese Betriebe überhaupt erreicht.

### Offen: Weg B des Belegarchivs liegt durch die gescheiterte Erhebung wieder auf dem Tisch

**Der Stand.** Am 11.08.2026 ist Weg A gewählt worden (`beleglist` je Betrieb und Belegart,
ohne Mandantenwechsel). Weg B (`/finanzen/document/filelistByBelegart`) liefert dieselben
Belege mit mehr Feldern — darunter `lineItems`, also die **Rechnungspositionen** — ist aber
an den im Kopf gewählten Mandanten gebunden: 131 Betriebe hießen 131 Mandantenwechsel.
Verworfen, und für den Bulk-Lauf zu Recht (`lina-api-inventar-ladenakte.md` §7.2).

**Warum die Ablehnung neu zu prüfen ist.** Die Excel war im Kern eine **Preiserhebung** —
79 Produkte, Preis je Betrieb, artikelgenau. Diese Frage beantwortet Weg A nicht: Er liefert
Belegkopf, Lieferant, Sachkonto und Nettobetrag, aber keinen Artikel und keinen Einzelpreis.
Am 11.08. war Weg B der teurere von zwei Wegen zum selben Ziel. Seit dem Rücklauf von 8,7 %
~~ist er der einzige bekannte Weg zu einem Ziel, das sonst gar nicht erreicht wird~~ — die
Alternative „den Fachbereich fragen" ist gemessen gescheitert. Das ändert die Rechnung, ohne
dass jemand die Entscheidung geändert hätte.

**Korrigiert am 12.08.2026, noch am selben Tag.** Weg B ist nicht der einzige Weg. Migration
`0056` beantwortet die Preisfrage aus den FoodNotify-Bestellungen — nachgemessen auf
`localhost/lina`: `mart.einkaufspreis_betrieb` trägt über die letzten zwölf Monate 3.974
Waren mit Preis je Betrieb und Ware, für **43 der 57 operativen Betriebe**. Was bleibt, ist
die andere Hälfte: die 14 operativen Betriebe ohne FoodNotify und alles, was am Bestellsystem
vorbei gekauft wurde. Dafür ist Weg B weiterhin der einzige bekannte Weg. Die drei
Entscheidungen hinter `0056` und ihre gemessenen Grenzen stehen am Ende dieses Blocks.

**Was unverändert dagegen steht, und es ist nicht der Aufwand.** Ein Wechsel des aktiven
Mandanten verändert Zustand in LINA. Genau das galt am 26.07.2026 bei der Standortkarte als
durch Regel 1 ausgeschlossen (Abschnitt „Die Standortkarte wartet auf Koordinaten"). Wer Weg
B will, muss diese Auslegung **ausdrücklich** ändern — und nicht stillschweigend, weil die
Zahlen diesmal wertvoller erscheinen. Erschwerend: Der Aufwand lässt sich nicht vorab
messen, ohne den Zustandswechsel schon einmal zu machen; ein rein lesender Messaufruf im
Sinne von `bun run lina-fragen` gibt es hier nicht.

**Nicht entschieden.** Dieser Abschnitt legt nichts fest. Er hält fest, dass die Ablehnung
vom 11.08.2026 unter einer Annahme getroffen wurde, die seit dem 12.08.2026 nicht mehr gilt,
und dass die Wiedervorlage eine Entscheidung über Regel 1 ist, keine über Laufzeit. Der
Punkt steht in [`offene-punkte.md`](offene-punkte.md).

### Dieselbe Erhebung, die andere Hälfte der Frage: Migration `0056`

Die Excel wollte zweierlei — **wo** eingekauft wird (das beantwortet `mart.fremdeinkauf` aus
`0055`, oben) und **was jeder Betrieb für ein Produkt zahlt**. Die zweite Hälfte beantwortet
`mart.einkaufspreis_betrieb` aus Migration `0056`, am 12.08.2026 auf `localhost/lina`
angewendet. `mart.einkaufspreis_monat` (`0041`) konnte es nicht: Sie gruppiert nach Ware,
Marke, Einheit und Monat — ohne Betrieb und ohne Lieferant, also ohne die Achse, um die die
Erhebung überhaupt gefragt hat. Nachgemessen im Fenster ab April 2026: 35.587 Zeilen, 2.896
Waren, 49 Betriebe, davon 24.682 Zeilen als `vergleichbar` gekennzeichnet.

Drei Entscheidungen tragen die Sicht. Alle drei sind gemessen — und bei allen dreien steht
unten, was die Messung von der Begründung übrig lässt. Bei der dritten ist das viel.

### Verglichen wird der Preis je Basiseinheit, nicht der Gebindepreis

**Entscheidung.** `summe_preis / gesamt_menge` (Euro je Liter, Kilo, Stück) statt
`summe_preis / menge` (Euro je Gebinde) wie in `0041`.

**Begründung.** Über die Zeit hinweg bucht derselbe Besteller dasselbe Gebinde; über
Betriebe hinweg nicht. Ein Betrieb bucht den Karton als `menge = 1`, der nächste sechs Flaschen
als `menge = 6` — dieselbe Ware, dasselbe Geld, Faktor 6 im Gebindepreis. Die erste Fassung
der Sicht rechnete mit dem Gebindepreis, und ihre Trefferliste bestand aus genau diesem
Artefakt: „Elka Orangensaft" 67,02 gegen 11,17, „Grana Padano" 147,90 gegen 14,79, dazu ein
Dutzend Zeilen mit exakt 500,0 Prozent Abweichung.

**Verworfene Alternative: der Gebindepreis, wie ihn `0041` benutzt.** Er ist nicht verworfen,
sondern entmachtet — er steht als `preis_je_gebinde` daneben, weil ein Einkäufer in
Kartonpreisen denkt und nicht in Cent je Milliliter. Zum Lesen, nicht zum Rechnen.

**Was die Messung von der Begründung übrig lässt.** Der Migrationskopf beruft sich auf 979
Waren mit mindestens vier Betrieben, Median der Spanne 1,03 bei beiden Preisen, über Faktor 3
streuen 119 Waren beim Gebindepreis und nur 67 beim Preis je Basiseinheit. Nachgemessen am
12.08.2026 über bar-Positionen der letzten zwölf Monate: 962 Waren, Median 1,02 gegen 1,02,
über Faktor 3 **87 gegen 34**. Die Richtung hält, die Zahlen nicht. Über die Grundgesamtheit,
die die Sicht tatsächlich liest (beide Bereiche, ganze Historie), **kehrt sich das Ergebnis
um**: 2.182 Waren, Median 1,06 gegen 1,07, über Faktor 3 **286 beim Gebindepreis gegen 337
bei der Basiseinheit**. Nach dem eigenen Maßstab der Entscheidung ist die Basiseinheit dort
die schlechtere Wahl. Belegt ist sie im jungen bar-Bestand, nicht in dem Bestand, den die
Sicht ausliefert.

**Und sie umgeht eine Absicherung, die es schon gibt.** `0042` hat
`core.bestellposition.preis_je_einheit` für genau diese Größe gebaut und trägt dort `NULL`
ein, wo `gesamt_menge` nicht belastbar ist (`menge_unstimmig`) — der Fall „48.400 EUR/kg
statt 48,40". `0041` liest diese Spalte, `0056` rechnet die Größe stattdessen neu und
ungeprüft aus `summe_preis / gesamt_menge`. Nachgemessen: **5.466 als `menge_unstimmig`
markierte Positionen** fließen in die Basis von 603.941 Positionen, und „Idee Entkoffeiniert
50 Pouches A 7G" steht im Juli 2026 mit `preis = 48.400,0000` je kg und demselben Wert als
`konzern_median` in der Sicht — der Ausreißer, der in `0042` der Anlass war. 455 von 9.509
Ware/Einheit/Monat-Zellen liefern damit einen anderen Preis je Basiseinheit als
`mart.einkaufspreis_monat.preis_je_einheit_median`, größte Differenz 47.432 EUR. Das sind die
„zwei Wahrheiten für dieselbe Frage", die der Migrationskopf zu verhindern verspricht.

**Der `COMMENT ON VIEW` beschreibt am 12.08.2026 eine andere Sicht als die gebaute:** „DIE
PREISBASIS IST DER GEBINDEPREIS (summe_preis / menge)", „mehrkosten ist die Abweichung MAL
der bezogenen Gebindezahl" und „Median der Gebindepreise" an
`einkaufspreis_betrieb.preis` — dreimal das Gegenteil dessen, was der Code rechnet, und
zweimal im Widerspruch zum Kopf derselben Datei. Wer die Sicht in Metabase liest, sieht diese
Texte im Datenmodell. Nicht behoben.

### Der Maßstab ist der Median der Betriebspreise, gebildet nur aus operativen Betrieben

**Entscheidung.** Vergleichswert je Ware, Einheit und Monat ist der Median **der
Betriebspreise** — jeder Betrieb zählt einmal, unabhängig davon, wie oft er bestellt hat. In
diesen Median gehen nur Betriebe mit `status = 'operativ'` ein.

**Verworfene Alternative: der Median über alle Positionen.** Dann bestimmt ein Betrieb mit 500
Bestellungen den Wert, gegen den ein Betrieb mit fünf gemessen wird — „Konzern" hieße dann „der
größte Besteller". Nachgemessen am 12.08.2026 ist der Unterschied selten und dort, wo er
auftritt, groß: In 155 von 9.276 Gruppen (1,7 Prozent) weichen beide Maßstäbe voneinander ab,
bis zum Faktor 12,5. Die Entscheidung ändert für 98 von 100 Waren nichts und rettet die
Fälle, in denen es zählt.

**Verworfen: geschlossene Betriebe aus der Sicht filtern.** Sie bilden den Maßstab nicht mit —
ein geschlossener Betrieb soll den Preis, an dem sich ein offener messen lassen muss, nicht
bestimmen. Ihre Zeilen bleiben aber stehen und bekommen ihre Abweichung gegen den operativen
Maßstab (Falle 12: die Sicht filtert nicht, sie kennzeichnet). Nachgemessen im Fenster ab
April 2026: 4.190 Zeilen aus sechs nicht operativen Betrieben, 2.897 davon mit Abweichung,
keine einzige Zeile ohne `betrieb_status`.

**Was die Umsetzung nicht hält — und das ist blockierend.** `je_betrieb` gruppiert zusätzlich
nach `bereich` (`core.kostenstelle.art`, also Bar und Küche), und der Maßstab zählt darüber
mit `count(*)`. Ein Betrieb, der dieselbe Ware über beide Bereiche bucht, geht **zweimal** in
`betriebe_operativ` und zweimal in den Median ein — der Kommentar „So zählt jeder Betrieb
einmal" ist wörtlich falsch. Nachgemessen: 12.577 doppelte Betrieb-Zellen über die ganze Sicht
(12.522 durch `bereich`, 55 durch den Lieferanten), 1.525 im Fenster ab April; 1.077 von
9.519 Gruppen zählen zu hoch, bis +8. **50 Gruppen erreichen die Drei-Betriebe-Schwelle allein
durch die Doppelzählung**, und 156 Zeilen tragen deshalb `vergleichbar = true` samt
`abweichung_pct`, obwohl real nur zwei Betriebe beteiligt sind. Der Median selbst verschiebt
sich in 180 von 9.190 Gruppen, höchstens um 2,1936 EUR je Basiseinheit. Die Entscheidung
bleibt richtig, der Code setzt sie nicht um: er bräuchte `count(DISTINCT betrieb_key)` und
eine Zwischenaggregation je Betrieb vor dem Median.

### `einheit_verdaechtig`: eine Heuristik, die bewusst echte Fälle unterdrückt

**Entscheidung.** Liegt der Quotient aus Betriebspreis und Konzernmedian auf 0,001 genau auf
einem ganzzahligen Vielfachen ab 2, gilt die Zeile als Mengenartefakt: `vergleichbar = false`,
`abweichung_pct` und `mehrkosten` bleiben `NULL`. Anlass ist „Tequila Silver 1l Karton 6x1l"
mit 11,5783 gegen 1,9297, Faktor 6,0000 — beide Betriebe buchen dieselbe Gebindegröße, aber das
eine zählt in `gesamt_menge` Kartons und das andere Liter. `gebinde_uneinheitlich` sieht das
nicht, weil dort die Größe übereinstimmt.

**Der Preis ist bewusst in Kauf genommen.** Wer tatsächlich exakt das Doppelte zahlt, fällt
heraus. Der Tausch: eine erfundene Meldung „500 Prozent zu teuer" verbrennt die ganze
Auswertung, ein übersehener Fall nicht. Dieselbe Abwägung wie bei den Aktionsartikeln am
11.08.2026 — lieber untererfassen als falsch zusammenführen.

**Wie hoch der Preis wirklich ist, nachgemessen am 12.08.2026.** Im Fenster ab April 2026
sind 42 Zeilen geflaggt. 16 tragen denselben Gebindepreis wie ihre Gruppe — dort steckt der
Faktor ausschließlich in der Basiseinheit, also zweifelsfrei Artefakt. 16 weitere weichen bei
Gebinde- **und** Basispreis um denselben Faktor ab, sind also ebenfalls Mengenbuchung. Es
bleiben **zehn** Zeilen, in denen ein echter Preisunterschied stecken kann, sechs davon ein
und dieselbe Ware (Grana Padano). Klarster Kandidat: „Tk Erdbeeren Cama. 2,5Kg", Betrieb 55 —
halber Gebindepreis (11,05 gegen 22,10), doppelter kg-Preis, also die kleinere Packung. Der
befürchtete Verlust ist einstellig, der Tausch damit günstiger als angenommen.

**Das Problem ist nicht, was die Heuristik verwirft, sondern was sie nicht ansieht.** Zwei
Lücken, beide gemessen, beide im selben Fenster:

1. **Nur die teure Richtung.** Geprüft wird `preis / median`, nie `median / preis`. Der
   spiegelbildliche Fall — dieser Betrieb zählt Liter, die anderen Kartons — läuft durch: 79
   Zeilen mit auf 0,001 ganzzahligem Kehrfaktor, **66 davon `vergleichbar = true`**,
   Abweichungen bis **−90,0 Prozent**, in Summe **−37.339 EUR erfundene „Ersparnis"**.
2. **Bimodale Gruppen sieht sie gar nicht.** Liegt der Median zwischen zwei Mengen-Clustern,
   ist kein Quotient ganzzahlig. „Captain Morgan Dark Rum 40% 1l Karton 12x1l": jeder Betrieb
   zahlt exakt 147,84 EUR je Karton, die Sicht meldet für die einen **+84,6**, für die
   anderen **−84,6 Prozent**, alle `vergleichbar = true`, `einheit_verdaechtig = false` (der
   Median 6,6733 liegt zwischen 12,32 und 1,0267). Insgesamt 78 Gruppen mit auf 0,001
   ganzzahliger Spreizung, 643 Zeilen, davon 311 vergleichbar und nur 34 geflaggt. Aus diesen
   Gruppen stammen **−45.045 von −55.282 EUR, also 81 Prozent** aller negativen `mehrkosten`
   der Sicht.

Dazu eine Kleinigkeit mit derselben Wirkungsrichtung: `einheit_verdaechtig` ist in 3.676
Zeilen der Sicht weder `true` noch `false`, sondern `NULL` — dort ist `konzern_median` `NULL`,
und der ganze `AND`-Ausdruck wird es mit. Ein `WHERE NOT einheit_verdaechtig` verliert diese
Zeilen still. `vergleichbar` und `gebinde_uneinheitlich` haben das Problem nicht.

**Was daraus für den Leser folgt, bis das behoben ist.** Die teuren Ausreißer der Sicht
tragen; die günstigen tragen nicht. „Dieser Betrieb kauft 85 Prozent günstiger" ist zu vier
Fünfteln Mengenartefakt. Eine Einsparliste aus `mehrkosten < 0` ist am 12.08.2026 keine
Einsparliste.


---

## 12.08.2026, nachmittags — zwei Korrekturen vor dem Commit

Beide Abschnitte oben beschreiben Stände, die **vor** dem Commit noch geändert wurden. Der
Text bleibt stehen, weil die Begründungen weiter gelten; hier steht, was daraus wurde.

### Revidiert: drei Zustände wurden zwei

Oben steht ausführlich, warum `mart.fremdeinkauf` drei Zustände führt und „nicht
eingeordnet" der Standard ist. **Der Nutzer hat das am 12.08.2026 verworfen**, und die
Begründung trägt: dass eine Brauerei mit Liefervertrag berechtigt ist, ist kein Grund für
einen dritten Zustand, sondern ein Grund, sie in `manual.lieferant_freigabe` einzutragen.
Dafür ist eine Freigabeliste da.

Der Preis der alten Fassung war eine Auswertung, die vor 112 Klassifizierungen nichts
anzeigt — eine leere Verdachtsliste, die wie „kein Fremdeinkauf" aussieht. Die neue liefert
sofort: **1.116.877 EUR bei 71 Lieferanten und 33 Betrieben** in den letzten zwölf Monaten.

Was der dritte Zustand wert war, steht jetzt in der Spalte `grund`: sie trennt
`ausdruecklich gesperrt` von `steht nicht auf der liste` und nennt bei Getränken
`fremder getraenkehaendler`. Für den Befund macht das keinen Unterschied, für die
Arbeitsplanung schon.

### Behoben: die fünf blockierenden Befunde an `0056`

Der Prüflauf zu `0056` fand fünf blockierende Fehler. Alle wurden **vor dem Commit** in
derselben Migration behoben, nicht in einer Folgemigration — `0056` war zu dem Zeitpunkt
nirgends committet:

| Befund | Behebung |
|---|---|
| `bereich` im Korn zählte Betriebe doppelt (50 Gruppen erreichten die Schwelle nur dadurch) | `bereich` und Lieferant aus dem `GROUP BY` entfernt, stehen als Anzeige daneben. Nachgemessen: 0 Gruppen zählen noch falsch |
| `menge_unstimmig` umgangen, 48.400-EUR-Kaffee zurück | Die Sicht nimmt jetzt `core.bestellposition.preis_je_einheit` aus `0042` und rechnet sie nicht nach. Kosten: 5.398 von 621.614 Positionen |
| `einheit_verdaechtig` prüfte nur die teure Richtung | Heuristik ersetzt durch `menge_widerspruechlich` — die Basiseinheit streut weiter als der Gebindepreis |
| Bimodale Gruppen (Captain Morgan: überall 147,84 EUR, gemeldet ±84,6 %) | Vierte Sperre `spreizung_zu_gross`: mehr als Faktor 3 zwischen den Betrieben ist eine Mengenbuchung, kein Preis. Kostet 96 von 17.748 Gruppen |
| Drei `COMMENT`s beschrieben den Gebindepreis, gerechnet wurde die Basiseinheit | Kommentare berichtigt |

Wirkung, nachgemessen am 12.08.2026: die negativen `mehrkosten` — also die erfundene
„Ersparnis" — sind von **−55.282 auf −17.512 EUR** gefallen.

**Was bleibt:** dicht unter der Dreifach-Grenze stehen weiter Zeilen mit glatten Faktoren
(150,0 und 200,0 Prozent). Belastbar ist die Sicht im einstelligen bis niedrig
zweistelligen Bereich — dort, wo Einkaufsbefunde tatsächlich liegen. Dreistellige
Abweichungen gehören vor der Weitergabe am Beleg geprüft.

---

## 13.08.2026 — Phase 1 des Datenvollständigkeits-Plans

Anlass: `docs/plan-datenvollstaendigkeit.md`, Abschnitt 3, Phase 1 — alles, was **heute**
Daten verliert, die morgen nicht mehr nachholbar sind.

### Der Belegarchiv-Zulauf wird gezählt, nicht geraten

Drei Wege standen zur Wahl:

**A — jede Nacht alles neu holen.** Ehrlich und viel zu teuer: 621 volle Ordner brauchten im
Erstabzug acht Stunden und mehrere hundert Megabyte. Bei 1.048 nicht leeren Paaren wäre das
der ganze Tag, jeden Tag, für einen Zuwachs von im Mittel 331 Belegen.

**B — nur das Delta holen** (`start=<bekannter Stand>&length=…`). Ein Aufruf statt zwei, und
er bringt gleich die neuen Zeilen mit. **Verworfen**, weil `start` eine Zeilennummer ist und
keine Beleg-ID: wird in der Mitte eines Ordners einer gelöscht und einer angehängt, bleibt
`recordsTotal` gleich, das Fenster verschiebt sich, und der neue Beleg fehlt für immer. Die
Gegenprobe ist gemessen — `lina_id` läuft innerhalb eines Ordners nicht verlässlich mit der
Uploadzeit (Korrelation im Mittel 0,991, aber acht Ordner unter 0,9, kleinster Wert 0,779).
Ein lautloser Verlust als Reparatur eines lautlosen Verlusts wäre die falsche Richtung.

**C — zählen, dann bei Abweichung ganz holen.** Gewählt. Die Zählung kostet eine Zeile, der
volle Abzug bleibt unverändert — samt seiner Vollständigkeitsprüfung (`Zeilen ==
recordsTotal`), die die einzige Zusicherung ist, die es überhaupt gibt. 1.834 Zählungen plus
262 Token-Aufrufe sind rund 2.238 von 10.500 Aufrufen am Tag.

### Verglichen wird gegen `count(*)`, nicht gegen die letzte Zählung

Naheliegend wäre „ist `records_total` seit gestern gewachsen?". Die gewählte Bedingung ist
„halten wir genau so viele, wie LINA zählt?" — sie fängt zusätzlich den mittendrin
abgebrochenen Abzug, den in LINA gelöschten Beleg und den nie geholten Ordner. Belastbar ist
sie, weil die Gleichheit gemessen ist: am 13.08.2026 stimmte sie für alle 621 abgezogenen
Ordner auf den Beleg genau.

### Die sechs nie geholten Belegarten werden gezählt, aber nicht geholt

Punkt 3 in Abschnitt 4 des Plans ist offen und gehört Eugene. Sie **nicht** zu zählen hieße,
die Entscheidung ohne Grundlage zu lassen; sie zu **holen** hieße, sie vorwegzunehmen. Also:
zählen, nicht holen, und den Zustand in `mart.belegarchiv_zulauf` sichtbar machen. Umschalten
ist danach ein `UPDATE` auf `core.belegart.inhalt_holen`, keine Migration.

### Die 275 aufgegebenen Posten werden wiederbelebt, nicht neu angelegt

Eine zweite Zeile für dieselbe Arbeit machte `ergebnis = 'aufgegeben'` als Zählgröße wertlos
— und genau diese Zahl steht ab sofort in `mart.pruefung_uebersicht`. Der Posten wird deshalb
zurückgesetzt (`versuche = 0`, `erledigt_am = NULL`), nicht dupliziert.

**Und es bleibt ein Handbefehl.** Ein automatischer nächtlicher Rücklauf ohne Obergrenze wäre
derselbe Bau wie der 403-Zweig in `src/sync/worker.ts`: `versuche` hoch, `versuche` runter,
netto ±0, seit neun Tagen. Die Obergrenze ist Phase 3.3; bis dahin ist ein bewusster Befehl
ehrlicher als eine Schleife, die nie endet.

### `einreihenWennNeu()` ist entfallen

Ihr einziger Aufrufer war der Belegordner-Zweig. Die Lehre, für die sie zweimal bezahlt hat,
steht in `docs/fehlerkatalog.md` (12.08.2026) und im Quelltext an ihrer Stelle: ein
Wiederholtakt gehört an den **Zeitraum**, nicht an einen Ergebniswert. Dead code mit einer
ausführlichen Begründung ist schlimmer als kein Code — der nächste liest die Begründung und
sucht den Aufrufer.

### Revidiert am selben Tag: kein Handbefehl, der Lauf macht es selbst

~~Die 275 aufgegebenen Posten werden wiederbelebt, nicht neu angelegt … Und es
bleibt ein Handbefehl.~~ ~~`bun run einreihen --foodnotify-inventurpositionen`~~

**Entscheidung Eugene, 13.08.2026: kein Befehl auf dem Server.** Was fehlt, holt
der nächtliche Lauf. Beide Schalter sind wieder aus `src/einreihen.ts`
verschwunden.

Meine Begründung für die Handbefehle war, dass ein automatischer Rücklauf ohne
Obergrenze derselbe Bau wäre wie der 403-Zweig im Worker. Der Einwand stimmt —
die Schlussfolgerung war falsch. Nicht „dann eben von Hand", sondern „dann eben
mit Obergrenze". Ein Handbefehl ist keine Reparatur, sondern eine Verabredung,
und Verabredungen fallen aus: genau daran stand LINA am 02.08.2026 acht Tage
still, und genau daran fror das Belegarchiv am 12.08.2026 ein. Zweimal dieselbe
Signatur, zweimal Tage — und beide Male hätte ein Mensch „nur kurz" etwas
anstoßen müssen.

Was jetzt stattdessen läuft, in `nachfuellen()` bei **jedem** Sync-Lauf:

* `inventurpositionenNachziehen()` vergleicht `core.inventur.anzahl_positionen`
  mit den geladenen Zeilen. Dieselbe Bauart wie beim Belegarchiv: eine
  gemessene Invariante statt einer Liste. Sie ist belastbar — 349 von 358
  stimmen auf die Position genau überein, 9 sind abgeschnitten, **null** andere
  Ausreißer, keine Inventur ohne Positionen.
* `aufgegebeneWiederbeleben()` holt aufgegebene Posten höchstens
  `MAX_WIEDERBELEBUNGEN` (3) mal zurück, und nur, wenn derselbe Endpunkt in den
  letzten 24 Stunden mindestens einmal `ok` geliefert hat.

### Warum drei Wiederbelebungen und nicht unbegrenzt

Der ursprüngliche Einwand bleibt gültig und wird durch die Obergrenze
beantwortet: ein dauerhaft kaputter Posten kostete sonst jede Nacht
`MAX_VERSUCHE` Aufrufe und käme nie zur Ruhe. Drei Anläufe an drei Tagen
unterscheiden einen Aussetzer der Gegenstelle von einer Grenze der Quelle; was
danach noch steht, ist eine — und steht als solche in `mart.posten_aufgegeben`.

Die Zahl ist tragbar, weil `aufgegeben` selten ist: 275 von 168.725 erledigten
Posten sind **0,16 %**, gemessen am 13.08.2026.

### Warum die Wiederbelebung ein frisches `ok` verlangt

Ohne diese Bedingung verbrauchte ein zweitägiger Ausfall der Gegenstelle den
gesamten Vorrat aller Posten — ausgerechnet bevor sie wieder erreichbar ist.
Drei Leben sind nur dann drei Chancen, wenn sie nicht gegen eine Wand verspielt
werden.

### Was ein Handbefehl bleiben darf

`--historie` und `--foodnotify`. Der Unterschied ist nicht die Größe, sondern
die Frage, die sie beantworten. „Hol die Jahre 2018 bis 2024" ist eine
**Entscheidung**. „Es fehlen 936 Positionen, die schon einmal da sein sollten"
ist ein **Befund** — und ein Befund gehört repariert, nicht angeboten.

---

## 13.08.2026 (abends): Zwei Entscheidungen aus dem Review-Nachtrag

Beide von Eugene, mit den finalen Zahlen aus Lauf 89 (dem ersten mit
täglicher Zählung) auf dem Tisch. Grundlage:
`docs/plan-datenvollstaendigkeit-nachtrag.md`, Abschnitt „Entscheidungen".

### Entscheidung 5: Nachholauf für Bestelldetails — 12 Monate zurück

Alle 66.966 FoodNotify-Bestellungen wurden genau einmal im Detail geholt und
seither nie wieder; Status, Liefermengen (`adjustedQuantity`) und Preise sind
auf dem Stand des Erstabrufs eingefroren. Der einmalige Nachholauf (Punkt 2.6
des Nachtrags) geht **12 Monate zurück**: 22.581 Bestellungen ≈ 45.200
Aufrufe, verteilt auf zwei Nächte. Nicht gewählt: der komplette nicht-finale
Bestand (63.604 ≈ 127.000 Aufrufe) — das Dreifache für Zeiträume, die keine
Auswertung aktiv vergleicht. Ältere Bestellungen bleiben bewusst auf dem
Stand des Erstabrufs; wer sie ansieht, findet diese Grenze hier.

### Entscheidung 3 (Hauptplan): Die sechs nie geholten Belegarten — nicht holen

Finale Zählung: 476 Ordner, 20.501 Belege (sonstige Dokumente 6.028,
USt-Voranmeldungen 3.469, sonstige Auswertungen 3.416, OPOS-Listen 3.382,
Steuerunterlagen 692, Mahnungen 314). Nach den Namen kein Wareneinkauf, keine
Auswertung braucht sie. `core.belegart.inhalt_holen` bleibt für alle sechs
`false`. Die Absicherung, die die Entscheidung umkehrbar macht: die tägliche
Zählung läuft für sie weiter, und `mart.belegarchiv_zulauf` führt sie als
„gezaehlt, nicht freigegeben" — entsteht dort plötzlich Volumen, ist es
sichtbar, und das Umschalten ist ein UPDATE auf eine Zeile.

## 13.08.2026 (Phase 1c): Vier Entscheidungen aus der Umsetzung des Review-Nachtrags

### Ein Sperrmodus statt einer Sonderregel für Inventuren

`folgepostenEinreihen()` hätte auch fest verdrahtet werden können: „für
`fn:inventurpositionen` gilt etwas anderes". Stattdessen gibt es zwei benannte Modi
(`'alle'` / `'offen'`), und der Aufrufer wählt.

**Warum.** Die Unterscheidung ist keine Eigenschaft dieses einen Endpunkts, sondern der
Frage, ob ein Abruf EINMALIG oder WIEDERHOLBAR ist. Genau diese Verwechslung hat dieses
Projekt am 12.08.2026 schon einmal Tage gekostet (das Belegarchiv fror ein, weil die
Einreihbedingung die eines einmaligen Abzugs war). Ein Name, der die Frage stellt, ist mehr
wert als ein `if` mit dem Namen des Endpunkts darin — der nächste, der einen wiederholbaren
Abruf baut, sieht die Wahl, statt sie zu übersehen.

### Bei zu großem Schwund wird geworfen, nicht gelöscht — und nicht gewarnt

Drei Wege standen zur Wahl, wenn nach einem Abzug auffällig viele Belege fehlen: löschen und
warnen, nur warnen, oder werfen.

**Entschieden: werfen.** Eine Warnung steht im Log, und Logs liest niemand (AGENTS.md
Regel 10). Löschen wäre der eigentliche Datenverlust, falls die Antwort trotz `recordsTotal`
unvollständig war — dann hätten wir aus einer fremden Störung einen eigenen Schaden gemacht.
Werfen lässt die Transaktion zurücklaufen, der Bestand bleibt vollständig, der Posten läuft
über die Versuche in `mart.posten_aufgegeben`, und die Differenz steht sichtbar in
`mart.belegarchiv_zulauf`. Ein Mensch entscheidet, und bis dahin ist nichts verloren.

**Der Preis, bewusst in Kauf genommen:** ein Ordner, den LINA wirklich abräumt, scheitert
dann jede Nacht, bis jemand hinsieht. Das ist richtig herum — lieber ein Befund zu viel als
eine Löschung zu viel.

### Die Schwundschranke hat zwei Teile, nicht einen

**5 % UND mehr als 10 Belege**, beides muss gerissen sein.

**Warum nicht nur der Anteil.** Gemessen am 13.08.2026: Belegart 3970 führt 17 Ordner mit
zusammen 542 Belegen, im Schnitt 32 Stück. Dort ist ein einziger gelöschter Beleg schon über
3 %, bei zehn Belegen im Ordner sind es 10 %. Eine Schranke, die bei normaler Pflege
ausschlägt, wird abgeschaltet.

**Warum nicht nur die absolute Zahl.** Der größte freigegebene Ordner hält 12.668 Belege.
Zwanzig verschwundene Belege sind dort nichts, und eine Schranke, die dort erst bei Tausenden
greift, wäre bei den kleinen Ordnern blind.

### Die Ausklammerung „kein Belegarchiv" hat ein Zeitfenster von sieben Tagen

Betriebe ohne Belegarchiv aus der 36-h-Prüfzeile zu nehmen, wäre auch dauerhaft möglich
gewesen — der Zustand ändert sich selten.

**Entschieden: sieben Tage, danach fällt der Betrieb zurück in die Zeile.**

**Warum.** Die Ausnahme stützt sich auf einen Befund (`keine_daten` bei der Zählung), und ein
Befund veraltet. Ohne Fenster nähme ein einziges `keine_daten` aus dem März einen Betrieb für
immer aus der Überwachung. Schlimmer: fiele die Zählung insgesamt aus, wäre ausgerechnet die
Zeile still, die den Ausfall melden soll — der Wächter hätte sich selbst abgeschaltet.
**Eine Ausnahme darf ihren Beleg nicht überleben.**

### Das Wiederbelebungs-Limit bleibt an zwei Stellen, gehalten von einem Test

`mart.posten_aufgegeben` verdrahtet `wiederbelebt >= 3`, `src/status.ts` und
`src/sync/nachfuellen.ts` lesen `MAX_WIEDERBELEBUNGEN`. Eine Einstellungstabelle, aus der
beide lesen, wäre die saubere Lösung.

**Entschieden: nicht bauen.** Eine Tabelle, eine Migration, ein Lesepfad in der Sicht und ein
Pflegeweg — für eine Zahl, die sich seit ihrer Einführung nicht geändert hat. Stattdessen
hält `src/config.test.ts` den Vorgabewert auf 3 fest, und die Kommentare an beiden Stellen
verweisen aufeinander. Wer die Grenze ändern will, bekommt einen roten Test, und der nennt
die Sicht, die mitzuändern ist. Das ist keine Kopplung, aber es ist der Unterschied zwischen
„auseinandergelaufen" und „gemeinsam geändert".

## 13.08.2026 (Phase 2.6): Der Nachholauf ist kein Befehl

Der Nachtrag sah für die 21.737 eingefrorenen Bestellungen einen einmaligen Nachholauf vor —
„neben dem Nachtlauf, wie die Phase-1-Backfills", also einen Handbefehl. `--historie` und
`--foodnotify` sind ausdrücklich so gebaut, mit guter Begründung: sie stellen Zehntausende
Posten ein, und das soll eine Entscheidung sein.

**Entschieden: kein Befehl. Der Nachholauf ist eine Obergrenze im normalen Lauf.**

**Warum.** Die Entscheidung vom 13.08.2026 („kein Befehl auf dem Server") ist die stärkere,
und der Unterschied zu den Historien-Backfills ist real: `--historie` ist eine **Entscheidung**
(wie weit zurück wollen wir überhaupt?), dieser Nachholauf ist ein **Befund** (Daten, die
falsch sind und richtig werden müssen). Ein Befund, dessen Reparatur ein Mensch anstoßen muss,
ist eine Verabredung — und die beiden teuersten Ausfälle dieses Projekts, der 02.08. und der
12.08.2026, waren ausgefallene Verabredungen.

**Wie es ohne Befehl terminiert.** `BESTELLDETAIL_JE_LAUF` (11.000) begrenzt jeden Lauf, und
`ORDER BY bestellt_am DESC` sorgt dafür, dass zuerst das rollierende Fenster bedient wird.
Der Altbestand arbeitet sich über zwei Nächte ab, danach fällt der Verbrauch von selbst auf
das Fenster zurück — 5.962 statt 22.000 Aufrufe. Es muss nichts abgeschaltet werden, und es
gibt keinen Zustand „Nachholauf läuft noch", den jemand im Kopf behalten müsste.
`mart.bestelldetail_stand.nie_aufgefrischt` zeigt den Rest.

### Der Wiederholtakt hängt an der Bestellung, nicht an der Warteschlange

`bestelldetailsAuffrischen()` hätte auch über `folgepostenEinreihen()` mit einem dritten
Sperrmodus laufen können („erledigt, aber älter als 20 Stunden").

**Entschieden: `core.bestellung.detail_geholt_am`.**

**Warum.** Die Warteschlange ist ein Arbeitsvorrat, keine Datenhaltung — sie beantwortet
„was ist zu tun", nicht „wie frisch ist diese Bestellung". Genau diese Verwechslung steckt
hinter drei Befunden dieses Plans: die Einreihbedingung des Belegarchivs war die eines
einmaligen Abzugs (12.08.), die Folgeseiten-Sperre der Inventuren ebenso (N1), und die
Detailposten auch. **Ein Wiederholtakt gehört an eine Tatsache über die Sache, nicht an einen
Zustand der Schlange.** Nebenbei ist die Spalte sichtbar: wer eine Bestellung ansieht, sieht
ihren Stand.

### `imported` gilt als nicht final — bis es jemand gemessen hat

47.340 der 66.966 Bestellungen stehen auf `imported`. Ob dieser Status endgültig ist, weiß
niemand; zu FoodNotify gibt es keinen Kontakt.

**Entschieden: konservativ als nicht final behandeln.** Sie kosten damit einmal je zwei
Aufrufe im Nachholauf. Der Vergleich vorher gegen nachher beantwortet die Frage dann selbst —
und erst danach lässt sich entscheiden, ob der lange Schwanz jenseits der 45 Tage einen
Wochentakt braucht oder Ruhe hat. Eine Annahme, die sich für 43.474 Aufrufe messen lässt,
soll nicht geraten werden.

## 13.08.2026 (Phase 2.4/2.8/2.9): Vier Entscheidungen zur Betriebszuordnung

### Kein Lader-Case für `fn:betriebe` — die Messung hat den Auftrag widerlegt

Der Nachtrag verlangte einen echten Lader-Case für `fn:betriebe`, weil dort die Restaurants
lägen, die die 25 unzugeordneten Kostenstellen erklären. **Gemessen:** alle 78 Restaurants
sind bereits in `core.kostenstelle`, mit identischen Namen, und die einzige zusätzliche
Information ist eine für alle gleiche Zeitzone.

**Entschieden: nicht bauen.** Eine Tabelle, die eine andere Spalte für Spalte doppelt, ist
keine Datenhaltung, sondern eine zweite Stelle, an der dasselbe falsch stehen kann. Der Punkt
steht durchgestrichen in `lina-api-korrekturen.md` — wer nicht sieht, dass eine Annahme einmal
galt, stellt sie neu auf.

### Apostrophe werden gelöscht, nicht zu Leerzeichen

**Entschieden: löschen**, und alle fünf Varianten (`´ ` ' ’ ‘`) statt der bisherigen drei.

**Warum nicht Leerzeichen.** „Lehner´s" und „Lehners" meinen dasselbe Haus; als „lehner s" und
„lehners" treffen sie sich nie. Es ist derselbe Gedanke wie bei den Umlauten eine Zeile
darüber — was zwei Systeme verschieden schreiben, aber gleich meinen, muss gleich aussehen.

**Warum das messbar sicher ist.** Über alle 79 Restaurants × 141 Betriebe: 59 exakte Treffer
vorher, 60 nachher, **0 verloren, keine neue Kollision**. Apostrophe tragen überhaupt nur 6
der 79 Restaurantnamen und keiner der 141 Betriebsnamen. Ein Test hält die fünf Varianten
fest und prüft mit dem Bindestrich gegen, dass die Zeichenliste nicht zu gierig wird.

### Die sechs offenen Zuordnungen werden NICHT geraten

`manual.betrieb_zuordnung_anwenden()` trägt nur exakte Treffer, bekannte Varianten und
menschliche Entscheidungen ein. „unsicher" und „kein_treffer" bleiben NULL.

**Entschieden: dabei bleibt es**, auch wenn zwei der offenen Fälle erhebliches Volumen tragen.
Bei „Aposto Aachen - Alte Post" (458 Bestellungen) führt LINA eine aktive **und** eine
geschlossene Gesellschaft desselben Namens; bei „Aposto Wuppertal II" (246) zwei Häuser, und
welches das „II" meint, sagt kein Name. Ein Automat, der hier rät, ordnet sechsstellige
Einkaufsbeträge lautlos dem falschen Betrieb zu — und lautlos falsch ist in diesem Projekt
teurer als offen.

**Sichtbar statt geraten:** `mart.kostenstelle_ohne_betrieb` und eine eigene Prüfzeile, die
Testbetriebe und Kostenstellen ohne Bestellungen ausdrücklich **nicht** mitzählt. Eine Zeile,
die nie auf null geht, wird nicht gelesen.

### FoodNotify-Stammdaten täglich, `analyticsFilterOptions` wöchentlich

Beide Takte hingen an „täglich wäre Verschwendung". An den Aufrufen gemessen stimmte das, an
der Wirkung nicht.

* **FoodNotify-Stammdaten: täglich.** Drei Endpunkte × vier Marken = 12 Aufrufe am Tag, gegen
  140.000 Budget bei ~200 verbrauchten. Eine neue Kostenstelle blieb vorher bis zu vier Wochen
  ohne `betrieb_key`.
* **`analyticsFilterOptions`: wöchentlich** (+3 Aufrufe im Monat, LINA-Budget 10.500 bei 82).
  Es ist die einzige Quelle für `core.betrieb.lina_betrieb_id`, und daran hängt die BWA **und**
  seit 0069 die tägliche Belegarchiv-Zählung. Ein neu eröffneter Betrieb wartete bis zu vier
  Wochen auf seine erste Zählung — derselbe Fall, den 0069 für die Ordner gelöst hat, eine
  Ebene höher.

Der Takt hängt in beiden Fällen weiter am **Zeitraum** (Kalendertag bzw. Montag der Woche) und
nicht an einem Ergebniswert. Ein Wiederholtakt, der an einem Ausgang hängt, kennt immer einen,
an den niemand gedacht hat.

### `kein_zugriff` ist ein eigener Ausgang, nicht ein Sonderfall von `aufgegeben`

Ein Posten, den FoodNotify dauerhaft mit 403 ablehnt, könnte auch als `aufgegeben` enden — die
Spalte gibt es, und `mart.posten_aufgegeben` zeigt sie an. Dagegen sprechen zwei Dinge.

**Technisch:** `aufgegebeneWiederbeleben()` holt jeden aufgegebenen Posten bis zu dreimal
zurück, sobald der Endpunkt irgendwo ein frisches `ok` hat — und `fn:bestellungen` hat das
jede Nacht. Der Posten liefe drei Wochen im Kreis für eine Antwort, die am ersten Tag
feststand.

**Inhaltlich, und das ist der eigentliche Grund:** `aufgegeben` heißt „wir haben es nicht
geschafft", `kein_zugriff` heißt „es gehört uns nicht". Das erste ist ein Befund und gehört
untersucht, das zweite ist eine Grenze und gehört notiert. Zwei Zustände in einer Spalte
zusammenzufassen, heißt, die Frage „muss jemand etwas tun?" wieder offen zu lassen.

### Vierzehn Tage, bevor ein 403 als Grenze gilt

Kürzer wäre eine Wette gegen die Verwaltung: ein nachgetragener Anspruch braucht Tage, nicht
Stunden. Länger hieße, dass eine fremde Kostenstelle die Ladestandsanzeige einen Monat lang
einfärbt. Nachgemessen: Posten 28629 lag zwölf Tage in dieser Schleife, ohne dass sich etwas
bewegte.

**Und geschlossen wird nur mit Gegenprobe** — derselbe Endpunkt derselben Marke muss in den
letzten 24 Stunden irgendwo ein `ok` gehabt haben. Ohne diese Bedingung räumte ein abgelaufenes
Passwort nach vierzehn Tagen den halben Bestand als „Quellengrenze" weg, und zwar lautlos.

### `sync.fortschritt` füllen, nicht entfernen

Punkt 3.4 des Plans ließ beides offen: „füllen oder ersatzlos aus `src/health.ts` entfernen".
Entschieden wurde füllen, nach dem Nachsehen, wer sie liest.

Drei der vier Spalten beantworten Fragen, die tatsächlich gestellt werden — wo steht welcher
Endpunkt (`0019`), welcher Betrieb hängt seit wann (`0039`). Nur `pausiert_bis` hatte keine
Entsprechung mehr, weil die Selbstdrosselung inzwischen als `faellig_ab` **am Posten** sitzt
und nicht als Pause an der Kombination. Genau das steht jetzt drin.

Entfernen hätte vier Leser und eine seit `0005` gepflegte Struktur weggeworfen, um eine
Prüfung loszuwerden, die nur deshalb nichts sagte, weil niemand sie bediente.

### Der Wächter misst zwei Zahlen, nicht eine

„Bekommt die Quelle noch Zulauf?" wäre mit einer Zahl zu beantworten — dem
Zeitpunkt der letzten Zeile. Die beiden Ausfälle, die diesen Wächter nötig
gemacht haben, waren aber verschiedene:

* **12.08.2026, Belegarchiv:** es wurde nicht mehr **gefragt**. Die
  Einreihbedingung war die eines einmaligen Abzugs.
* **10.08.2026, Yext-Analytics:** es wurde gefragt, der Merker war frisch — und
  die Tabellen waren leer.

Eine Zahl allein hätte beide Male beruhigt. `zuletzt_gefragt` und
`zuletzt_zulauf` trennen sie, und `wird_noch_gefragt` macht daraus die Frage,
auf die es ankommt: **ist das ein Befund oder ein Baufehler?** Eine Quelle, die
nichts liefert, kann in Ordnung sein. Eine, die niemand mehr abfragt, nie.

### Das Register steht in TypeScript, nicht in der Migration

Eine Tabelle mit einem `INSERT`-Seed wäre kürzer. Sie wäre aber ein **zweiter
Ort** für dieselbe Sache — und der zweite Ort ist immer der veraltete. Wer einen
Endpunkt anlegt, sieht das Register in `src/sync/quellen.ts` direkt daneben, und
`waechter.test.ts` prüft **ohne Datenbank**, dass keiner ohne Eintrag durchkommt.

Der Preis ist ein Schreibvorgang je Lauf (`quellenSpiegeln()`), und zwar als
Vollabgleich: was im Code verschwindet, verschwindet auch in der Sicht. Ohne das
stünde ein abgeschalteter Endpunkt für immer als „stumm" da — bis jemand die
Zeile nicht mehr liest.

### Der Lauf wird `teilweise`, nicht `fehlgeschlagen`

Regel 10 verlangt, dass der Lauf eine stumme Quelle nicht als „ok" meldet. Sie
verlangt nicht, dass er scheitert — und das wäre auch falsch: der Lauf hat
getan, was er konnte, und ein Exitcode 1 ließe Dokploy den Container neu
starten, was nichts löst und alles langsamer macht.

`teilweise` steht in `mart.sync_status`, die Namen stehen in der Notiz, `/status`
wird gelb (oder rot, wenn gar nicht mehr gefragt wird), und auf dem
Import-Dashboard steht die Zahl an zweiter Stelle. Ein Lauf, der schon
`abgebrochen` ist, behält seinen Status — die erste Ursache ist die wichtigere.

### Entscheidung 4 beantwortet: die acht übrigen Hauptsparten werden geholt

Der Plan fragte: „lohnt sich der Aufwand? *Empfehlung: ja, wenn es ein Parameter
ist.*" Es ist einer — `getUmsatzbericht:speisen` unterscheidet sich von
`getUmsatzbericht` durch genau ein Query-Feld, und `src/sync/laden.ts` schlägt
daraus schon seit dem 26.07.2026 generisch die `hauptsparte_key` nach.

**Kosten:** acht Endpunkte × 10 Nachzügler-Tage = 80 Aufrufe am Tag. Das
LINA-Tagesbudget ist 10.500, verbraucht wurden bis dahin rund 104.
**Nutzen:** 31,8 % des Umsatzes waren nicht aufteilbar (2.863.438,40 € in
30 Tagen).

**Beide Gutschein-Sparten werden geholt.** LINA führt `posId` 10003
(„Gutscheine", nummer 3) und 95 („Gutschein", nummer 57). Welche bebucht wird,
wissen wir nicht — und zwei Aufrufe am Tag sind billiger als eine Vermutung, die
später jemand für eine Messung hält.

### Das Belegdatum wird verworfen, nicht korrigiert

Ein Beleg mit Belegdatum 2038, hochgeladen 2025, ließe sich „reparieren" — etwa
auf das Hochladedatum setzen. Das wäre ein erfundener Wert. Dieselbe Regel wie
bei den Beträgen seit `0058`: **aus „unbekannt" darf kein Wert werden.**

`beleg_datum` wird NULL, der Rohwert steht in `beleg_datum_roh`, und alle vier
betroffenen Sichten filtern ohnehin auf `beleg_datum IS NOT NULL` — es musste
keine einzige Sicht geändert werden. Sichtbar bleibt der Fall in
`mart.belegdatum_ausreisser`.

**Die Grenze hängt am Hochladedatum, nicht an einer Jahreszahl.** Eine feste
Schranke veraltet still und wird irgendwann selbst zum Fehler; das Upload-Datum
steht in derselben Zeile und altert nicht.

### `mart.inventur_schwund` filtert selbst, statt auf `mart.inventurposition` zu joinen

Die 50.000-€-Schwelle steht damit an zwei Stellen. Ein Join auf die Sicht wäre
DRY, würde aber die Aggregation über 82.126 Positionen verdoppeln — und
`inventur_schwund` ist eine Sicht, die je Betrieb und Monat gruppiert.

Zusammengehalten werden die beiden Stellen durch den Ende-zu-Ende-Test, der
beide Zahlen gegen dieselbe Lage prüft. Eine doppelte Konstante mit Test ist
besser als eine einzelne mit doppeltem Plan.

### Der Yext-Vollabgleich läuft monatlich, nicht täglich

Täglich wären es 3.300 Aufrufe statt 400 — bei einem Stundenlimit von 5.000
machbar, aber ohne Nutzen: ein Stand ist kumuliert, der März ändert sich nicht
mehr. Was ihn doch ändert, sind **gelöschte** Bewertungen, und die tröpfeln über
Wochen.

**Der Takt hängt an einem Merker und nicht am Monatsersten.** Ein
„am Ersten"-Takt hätte den Ausfall genau eines Laufs zum Ausfall eines ganzen
Monats gemacht — dieselbe Überlegung wie bei den 20 Stunden des täglichen Laufs,
die bewusst keine 24 sind.

### Die sieben Betriebe ohne Yext-Zuordnung werden nicht geraten

Für drei der sieben gibt es in `src/yext/zuordnen.ts` einen Verdacht, der
ausdrücklich als `null` — also OFFEN — eingetragen ist: `L_03` „Lehners
Wirtshaus Pforzheim" könnte B+L Pforzheim sein, `EK_14` „Würzburger
Hofbräukeller" die WHK Gastronomie, `EK_06` „Carls Brauhaus" das Wirtshaus am
Schlossplatz.

**Ein Automat, der hier rät, hängt einem Betrieb die Bewertungen eines anderen
an** — und eine falsche Note im Round Table löst dieselbe Eskalationsstufe aus
wie eine echte. Dieselbe Entscheidung wie bei den Kostenstellen ohne Betrieb
(`0073`): sichtbar machen, nicht raten. `mart.betrieb_ohne_yext` ist die
Arbeitsliste, `VON_HAND` die Stelle, an der ein Mensch entscheidet.

### Die Backfills laufen jetzt mit, statt auf Zuruf

Bis zum 14.08.2026 stand in `AGENTS.md`, in `einreihen.ts` und im Kopf von
`nachfuellen.ts` derselbe Satz: die Historien-Backfills blieben **ausdrücklich**
Handarbeit, sie stellten Zehntausende Posten ein, und das solle eine
Entscheidung sein, kein Nebeneffekt eines Neustarts.

Das Argument war richtig und die Folgerung falsch. **Eine Entscheidung, die
jemand jedes Mal neu treffen muss, wird irgendwann nicht mehr getroffen, und ihr
Ausfall sieht aus wie Ruhe** — genau die Signatur, die dieses Projekt zweimal
Tage gekostet hat.

An die Stelle der Entscheidung tritt eine **Obergrenze je Nacht**
(`HISTORIE_JE_LAUF`, 2.000 von 10.500 Aufrufen). Das ist dieselbe Bauart wie
beim Bestelldetail-Nachholauf (`0072`): kein Befehl, sondern eine Zahl, die sich
von selbst abarbeitet und dabei nie in die Nähe des Budgets kommt. Auf 0 gesetzt
hört sie auf — das ist die Notbremse und kein Handgriff.

### Der Kanal für die Handpflege ist das Repository

Drei Wege standen zur Wahl: ein Upload auf den Server, ein Web-Formular, oder
eine Datei im Repo.

Das Repo gewinnt, und zwar nicht aus Bequemlichkeit. Es bringt drei Dinge mit,
die die anderen beiden erst bauen müssten: eine **Historie** (wer hat wann
welche Note geändert), eine **Überprüfung vor dem Wirksamwerden** (der Commit
ist lesbar, bevor er ausgerollt wird), und einen **Weg zurück** (`git revert`).
Ein Web-Formular wäre außerdem ein zweites System mit eigener Anmeldung, eigener
Rechteverwaltung und eigener Ausfallwahrscheinlichkeit.

Der Preis ist eine Deploy-Runde je Änderung. Bei einer Notenliste, die einmal im
Monat gepflegt wird, ist das keiner.

### Feiertage kommen aus einer fremden Schnittstelle, nicht aus einer Formel

Deutsche Feiertage sind berechenbar — aus dem Osterdatum und einer Tabelle je
Bundesland. Genau das wäre hier falsch gewesen.

`manual.feiertag` trug 21 verschiedene Namen für die Feiertage, darunter
„1. Weihnachtsfeiertag" **und** „1. Weihnachtstag", „Neujahr" **und**
„Neujahrstag" — die Spur zweier Quellen (`feiertage-api.de` und
`openholidaysapi.org`). Der Primärschlüssel enthält den Namen. Eine eigene
Berechnung hätte also entweder Dubletten erzeugt oder Namen überschrieben, die
seit 2018 in Auswertungen stecken. Seit `0089` ist nur noch eine Quelle drin,
und damit ein Namensschema; `manual.feiertag_alias` (0084) bleibt als Puffer für
den Fall, dass die Quelle selbst umbenennt.

Dazu kommt: **Schulferien sind nicht berechenbar.** Sie werden je Land
festgelegt. Eine Quelle, die beides liefert, ist einer Formel plus einer zweiten
Quelle vorzuziehen.

Genommen wird `openholidaysapi.org` — frei, ohne Schlüssel, ohne Anmeldung, und
bereits eine der beiden Quellen des Bestands. **Der Bestand wird nicht
umgeschrieben:** neue Namen legen im Zweifel eine zusätzliche Zeile an, statt
eine alte zu ändern.

### Entscheidung 1 (Hauptplan): Grün heißt ab jetzt „geprüft", nicht „nichts gefunden"

Die Frage lautete: *darf eine Ampel grün sein, wenn ein Signal fehlt?* Sie war
als „muss Eugene entscheiden" markiert, mit der Empfehlung **nein**. Umgesetzt
am 14.08.2026 in Migration `0080` — und die Messung sagt, warum das mehr ist als
eine Geschmacksfrage.

`ampel.gesamt()` ignorierte NULL-Signale und fiel auf `ELSE 'gruen'` durch. Das
Gesamturteil wurde also **gut, WEIL etwas fehlte**. Seit Juli 2026 ist `ampel_om`
für alle 141 Betriebe leer (`manual.om_einschaetzung` endet im Juni), und der
Umsatzvergleich fehlt im laufenden Monat ohnehin allen.

**Was sich ändert und was ausdrücklich nicht:**

| | |
|---|---|
| `rot` | unverändert. Ein fehlendes Signal darf ein rotes **nie** verdecken |
| `orange` | unverändert |
| `gruen` | nur noch, wenn **alle sechs** Signale vorlagen |
| `unvollstaendig` | neu, dazwischen |
| `NULL` | unverändert: gar kein Signal heißt „nicht beurteilt", nicht „unvollständig" |

Die Änderung macht den **Freispruch strenger, nicht die Eskalation weicher**.

**Die ehrliche Folge, gemessen:** nach der Umstellung ist im Moment **kein
einziger** Betrieb grün — weil keiner alle sechs Signale hat. Das ist die
Aussage, nicht ein Fehler. Pro Monat wechseln 5 bis 8 Urteile von grün auf
unvollständig; die roten und orangen bleiben, wo sie waren.

**Zurückdrehen ist eine Zeile.** Wer das anders entscheidet, streicht in
`ampel.gesamt()` die eine `WHEN cardinality(...) < cardinality(...)`-Zeile. Der
Rest bleibt, wie er war — und `mart.round_table_unvollstaendig` bliebe als
Arbeitsliste trotzdem brauchbar.

### Was ein Mensch weiterhin entscheidet — und was davon Bedienung war

Nach dem 14.08.2026 braucht der Betrieb **keinen Handbefehl** mehr. Was bleibt,
ist kein Knopf, sondern ein Urteil:

1. **Die OM-Noten für Juli und August** (Entscheidung 2 des Plans). Sie kommen
   von Menschen, nicht aus einer API. Neu ist nur der Weg: eine Zeile in
   `pflege/om_einschaetzung.csv`, committet und gepusht — keine Migration mehr.
2. **Die drei Verdachtsfälle bei Yext** (`L_03` → B+L Pforzheim, `EK_14` → WHK
   Gastronomie, `EK_06` → Wirtshaus am Schlossplatz). Ein Automat, der hier rät,
   hängt einem Betrieb die Bewertungen eines anderen an.
3. **Die zwei mehrdeutigen Kostenstellen** („Aposto Aachen – Alte Post",
   „Aposto Wuppertal II") in `manual.betrieb_zuordnung.entscheidung_key`.

Alle drei stehen in einer Sicht mit einer Arbeitsliste, keine davon in einem
Log. Das ist der Unterschied zwischen einer Entscheidung und einer Verabredung.

---

## Zwei Importschleifen, eine je Anbieter (19.08.2026)

**Anlass, gemessen an Lauf 95 vom 18.08.2026.** Der Lauf begann um 03:03 und
war gegen 15:20 fertig — 12 h 17 min. Aufgeteilt nach Anbieter, gerechnet aus
den Fortschrittszeilen des Laufprotokolls:

| Anbieter | Posten | Dauer | je Posten |
|---|---|---|---|
| LINA gesamt | 4.160 | **10 h 10 min** | |
| — davon `la:belegzahl` | 1.974 | 6 h 51 min | ~12,5 s |
| — davon Historie (`sv_*`) | 2.000 | 2 h 57 min | ~5,3 s |
| — davon Tagesdaten | 186 | 22 min | ~7 s |
| FoodNotify | 6.097 | **2 h 12 min** | ~1,3 s |

10 h 10 + 2 h 12 = 12 h 22 gerechnet gegen 12 h 17 gemessen. Die beiden
Anbieter teilten sich **eine** serielle Schleife, also addierte sich ihre Zeit.
FoodNotify stand dabei in LINAs Taktpausen still — mit eigenem Takt
(200–500 ms), eigenem Tagesbudget und nichts zu tun. Jeder LINA-Abruf zahlt
seine 4–6 s **additiv** zur Antwortzeit, weil `letzterRequest` in
`src/lina/client.ts` erst *nach* der Antwort gestempelt wird.

**Entscheidung:** eine Schleife je Anbieter, nebenläufig im selben Prozess,
zusammengeführt mit `Promise.allSettled`. Aus der Summe wird das Maximum.

**Warum das die „Ein Worker"-Entscheidung nicht bricht.** Weiter oben steht
„Zehn Worker wären zehnfaches Tempo gegen einen Zugang ohne Limits". Das
Argument gilt **prozessübergreifend**: zehn `bun run sync` nebeneinander sind
zehn Client-Instanzen mit zehn eigenen `letzterRequest`-Feldern und zehn
Budgetzählern, die alle denselben Datenbankstand laden. Die Drosselung hängt
an der **Instanz**, nicht an der Schleife. Die Grenze verläuft deshalb nicht
bei „eine Schleife", sondern bei **„ein Aufrufer je Client"** — und die bleibt
gewahrt: je Anbieter genau eine Instanz, genau ein Aufrufer. Die Advisory-
Sperre bleibt unangetastet: ein Prozess, eine Sperre, zwei Schleifen darin.

**Was jeder Anbieter sieht, ändert sich nicht.** Derselbe Mindestabstand,
dasselbe Budget. Was sich ändert, ist allein, wer während der Pause des
anderen arbeiten darf. Nachprüfbar nach dem ersten echten Lauf: die
Abstandsverteilung der LINA-Aufrufe muss weiter bei ≥ 4.000 ms liegen. Rutscht
das Minimum darunter, zieht jemand zweimal am selben Client.

**Der Anbieterfilter ist die Drossel, nicht eine Optimierung.** Ohne ihn zögen
beide Schleifen aus derselben Schlange; die Weiche im Worker wählte brav den
richtigen Client, und zwei Aufrufer hingen an einer Instanz: beide lesen
dasselbe `letzterRequest`, schlafen gleich lang und feuern gleichzeitig.
Doppelte LINA-Rate in Zweierbursts, ohne eine einzige Meldung. Deshalb
Migration `0082` (`sync.posten_holen(lauf, anbieter)`, unbekannter Wert wirft)
**und** ein zweiter Gürtel im Worker, der einen fremden Posten zurücklegt und
das laut protokolliert.

**Was der Umbau NICHT bringt — die ehrliche Zahl.** Der Lauf geht von 12 h 17
auf **rund 10 h 10**, also gut zwei Stunden. Mehr ist nicht drin, denn LINA
allein braucht diese 10 h und ist der kritische Pfad. **Zwei Drittel davon
sind `la:belegzahl`** (6 h 51 für 141 Betriebe × 14 FiBu-Ordner, jede Nacht
neu). Wer den Lauf wirklich kurz haben will, kürzt dort — nicht an der
Nebenläufigkeit. Steht in `offene-punkte.md`.

**Weiter geht die Nebenläufigkeit nicht.** Ein zweiter Worker desselben
Anbieters wäre eine echte Ratenerhöhung — zwei Instanzen, zwei Taktzähler,
zwei Budgets aus demselben Datenbankstand. Für FoodNotify ginge das nur mit
einer geteilten Schranke, die den nächsten Slot **vor** dem Request
reserviert; dabei muss der Takt um die mittlere Antwortzeit angehoben werden,
sonst ist der Umbau selbst eine Beschleunigung. Für LINA gar nicht: der
Token-Cache der Ladenakte (`src/ladenakte/token.ts`) ist modulglobal, hat kein
Dedupe für gleichzeitige Auflösungen, und seine 90-Sekunden-Frist ist
ausdrücklich auf **einen** Aufrufer gerechnet, der die Ordner eines Betriebs
am Stück abarbeitet. Wer mehr FoodNotify-Durchsatz will, dreht
`FN_TAKT_MIN_MS` — eine Zahl in der Konfiguration, in einer Zeile
zurückzunehmen, statt derselben Beschleunigung als Struktur versteckt.

**Was bewusst beim Alten bleibt:** die Zugangssperre beendet **beide**
Schleifen. `sync.zugangssperre` ist global (`sperre_aktiv()` kennt keine
Anbieterspalte) und wird beim Start für beide geprüft; FoodNotify
weiterlaufen zu lassen hieße, unter einer Sperre zu arbeiten, die den nächsten
Start ohnehin abweist. Dasselbe gilt für das Arbeitsfenster. Beides je
Anbieter zu führen wäre vertretbar, ist aber eine eigene Entscheidung — siehe
`offene-punkte.md`.

## 20.08.2026 — Kalender- und Wetterauswertung: fünf Festlegungen

Vorlage ist `docs/plan-kalender-wetter.md`, Abschnitt 5. Eugene hat den Bau
freigegeben, ohne die Einzelfragen zu beantworten; die Empfehlungen wurden
umgesetzt und stehen hier mit ihrer Begründung, damit eine andere Antwort
später ein Änderungsgrund ist und keine Archäologie.

**E1 — Wetterquelle: Bright Sky auf DWD-Messdaten** (`api.brightsky.dev`).
Open-Meteo wäre der bequemere Weg, scheidet aber aus: der kostenlose Zugang ist
ausdrücklich auf **nicht-gewerbliche** Nutzung beschränkt, und das hier ist
gewerblich. Die *Daten* stehen unter CC-BY 4.0, der *Zugang* nicht. DWD-Daten
sind unter GeoNutzV auch gewerblich frei, mit Namensnennung — die gehört ins
Dashboard. Der Abruf liegt hinter `src/wetter/quelle.ts`; ein Quellenwechsel
ist eine Datei, keine Migration.

~~**E2 — Zeitfenster für die Wetterverdichtung: 11–24 Uhr**~~ — das war die
*Empfehlung*, nicht die Entscheidung. **Eugene hat am 20.08.2026 08–24 Uhr
gewählt** (99,5 % des Umsatzes 2026 statt 95,0 %). Umgesetzt ist 08–24; alles
Folgende gilt entsprechend. Die ursprüngliche Abwägung bleibt stehen, weil sie
die Alternativen begründet: Nachgemessen am Umsatz 2026 über
`core.zeitzonenbericht_stunde`: 11–22 deckt **89,7 %**, 11–24 deckt **95,0 %**,
08–22 deckt 94,3 %. Late Night trägt 5,7 % und ist bei den bar-lastigen
Betrieben Teil des Geschäfts; das Frühstück trägt 4,6 % und würde den
Wetterwert für 26 % Abendessen mitziehen, ohne selbst ins Gewicht zu fallen.
Die Verdichtung über den **Kalendertag** wird zusätzlich gespeichert, die Wahl
ist also umkehrbar.

**E3 — Klassengrenzen für das Wetter:** die vorgeschlagenen Werte als
Startbelegung, aber **nicht als Endstand**. Sie sind geraten, nicht gemessen.
Sie stehen in `manual.wetter_klasse`, also in `pflege/`, also ohne Migration
änderbar; nach dem ersten Backfill wird die tatsächliche Verteilung gemessen
und eine nachgeschärfte Belegung vorgelegt.

**E4 — Der Messaufruf `d4` entfällt** — aber nicht mit der Begründung aus dem
Plan. Der Plan schreibt, „zwei der drei Antworten führen ohnehin zur externen
Quelle, und die dritte wäre bei Betrieben von Dresden bis Freiburg
unbrauchbar". Das stimmt nicht mit `src/messen.ts` überein: das
Dresden-Freiburg-Argument gehört zu Antwort **2** („nur eine Wetterlage für die
ganze Gruppe"). Antwort **1** („Wetterlage je Betrieb und Tag") **würde** die
externe Quelle erübrigen, und zwar für alle 141 Betriebe statt für 60.

Die Entscheidung bleibt trotzdem „streichen", mit der tragfähigen Begründung:
LINA liefert im besten Fall eine **Tages**-Wetterlage. Damit kein Stundenraster,
also kein Gastro-Fenster und keine Terrassenfrage; keine Historie ab 2018; und
ein weiterer undokumentierter HTML-Endpunkt in der Abhängigkeitskette. Bright
Sky kann alles davon. ~~`d4` in `offene-punkte.md`~~ ist damit aufgelöst.

**E5 — Betriebe ohne gepflegten Standort kommen in den Kalender, mit den
bundesweiten Feiertagen als Rückfall.** Nicht im Plan, sondern beim Bauen
aufgefallen: `mart.betrieb_kalender` kannte nur die **60** Betriebe mit
gepflegter PLZ. Die Materialisierung hätte für 81 Betriebe keine einzige Zeile
gehabt — auch nicht in der Tagesliste, auch nicht für den reinen
Wochentagsvergleich, der gar kein Bundesland braucht. Betroffen sind neun
Betriebe mit laufendem Umsatz, **15,1 Mio € (22 %)**, angeführt vom
umsatzstärksten Betrieb der Gruppe.

Die neun bundesweiten Feiertage tragen genau die großen Ausschläge (Neujahr
−68,7 %, Christi Himmelfahrt +68,4 %, Karfreitag −32,1 %, Pfingstmontag
+52,4 %); es fehlen die regionalen. Woher der Kalender eines Betriebs kommt,
steht in `mart.betrieb_kalender.kalender_quelle`, und
`mart.kalendereffekt_gruppe` filtert auf `bundesland` — die **veröffentlichten
Gruppenzahlen sind damit identisch** zur 60er-Variante, die Tagesliste deckt
aber alle 141 Betriebe.

**Verworfen:** alle 141 ohne Feiertagslogik für die 81. Dann landen Feiertage
ungefiltert im Vergleichsvorrat, ein Neujahr zieht den Schnitt der vier
Vergleichs-Mittwoche nach unten und lässt den Folgemittwoch glänzen. Billiger,
aber es baut still falsche Zahlen.

**Kosten der Entscheidung:** die Materialisierung trägt 443.304 statt 188.640
Zeilen. Gemessen am 20.08.2026: Aufbau 39 s, `REFRESH CONCURRENTLY` **40,9 s**.

**Was 08–24 konkret heißt, und es ist nicht der Kalendertag.**
`core.geschaeftstag()` schneidet um **08:00 Berliner Zeit**
(`(zeitpunkt AT TIME ZONE 'Europe/Berlin') - interval '8 hours'`). Das Fenster
08–24 sind damit exakt die **ersten 16 der 24 Stunden eines Geschäftstags**;
draußen bleiben die Stunden 0 bis 7 des Folgemorgens — 0,5 % des Umsatzes und
die Nachttiefstwerte. Genau darin unterscheiden sich die beiden gespeicherten
Verdichtungen noch: beim Temperatur-**Minimum**. Bei Maximum und Summen liegen
sie eng beieinander, was bei der Wahl absehbar war und in Kauf genommen wurde.

**E3, nachgetragen am 20.08.2026: die Klassengrenzen sind jetzt gemessen.**
Temperatur und Niederschlag bleiben wie vorgeschlagen — die Verteilung trägt
sie (15,1 / 30,2 / 24,1 / 16,6 / 14,0 % und 66,0 / 16,2 / 17,8 % über 4.735
Tage an 48 Orten). **Die Sonnenklasse nicht.** „Trüb unter 25 % Anteil" traf im
Januar 71,2 % der Tage und im Juni 19,6 %: im Fenster 08–24 sind im Winter acht
von sechzehn Stunden dunkel, die Klasse misst also die Jahreszeit. Sie rechnet
seit `0087` **relativ** gegen die letzten 28 Tage am selben Ort — dieselbe
Konstruktion wie der Vergleichstag, aus demselben Grund.

## 21.08.2026 — Geschlossene Betriebe fallen aus ⑫ heraus

**Angefragt:** „Enchi-Gruppe geschlossene ausschließen." Das ist kein Betrieb,
sondern ein Konzept in `mart.konzept_zuordnung` — der Sammelposten für 34
geschlossene und insolvente Enchilada-Betriebe, keiner davon mit laufendem
Umsatz.

**Umgesetzt als Daten, nicht als Name im SQL.** `manual.kalender_ausschluss`,
gepflegt über `pflege/kalender_ausschluss.csv` — dieselbe Bauart wie
`manual.wetter_klasse`. Grund: es gibt **drei weitere Konzepte mit derselben
Signatur** (Franchisegebergesellschaften 17, Sonstige Enchilada Gruppe 9, Ghost
Kitchen 3, alle ohne laufenden Umsatz). Sie bleiben vorerst drin, weil danach
nicht gefragt war; `mart.kalender_ausschluss_kandidaten` führt sie als
Entscheidungsliste.

**Wo der Ausschluss wirkt — und wo nicht.** Gefiltert wird in der
**Auswertungsschicht**: `mart.kalendertag_lage`, `mart.wettertag_lage` und die
Tagesliste auf ⑫. `mart.vergleichstag_basis` bleibt **vollständig** — die
Rohebene verliert keine Zeile, und wer einen geschlossenen Betrieb nachsehen
will, kann das weiterhin (Regel 10: sichtbar machen, nicht verschwinden
lassen).

**Verworfen: Filterung über `operativ` statt über das Konzept.** Ein Betrieb,
der 2025 geschlossen hat, war 2023 operativ — seine Feiertagsdaten von damals
sind fachlich gültig. Ein `operativ`-Filter hätte je nach Stichtag andere
Historie gezeigt und wäre bei jedem Monatswechsel anders ausgefallen. Das
Konzept ist die stabilere Aussage: dieser Betrieb ist zu, dauerhaft.

**Nebenbefund, der in die Kartenlesung gehört:** durch den Ausschluss von drei
Tagen sprang Neujahr von −68,7 auf −97,3 %. Nicht wegen des Gewichts, sondern
weil der Median dort auf der Kante zwischen „hat auf" und „hat zu" sitzt. Steht
als Spaltenkommentar an `mart.kalendereffekt_gruppe.median_pct`, damit es
niemand als Umsatzrückgang zitiert.

---

## 22.08.2026 — Pflichtartikel: die Frage wurde umgedreht

**Anlass.** Der Fachbereich hat Pflichtartikellisten (PAL) übergeben: je Konzept
eine Vorgabe, welche Artikel ein Betrieb führen muss. Zwei PDF (Wilma Wunder,
Küche und Bar), zwei XLSX (Aposto, Enchilada). Gefragt war, „welche Standorte
sich daran halten und welche nicht".

**Entschieden: die Leitzahl ist der Anteil daneben, nicht die Erfüllung.**
Auf Rückfrage präzisiert: gefragt ist, **welche Betriebe abseits der
Pflichtartikel bestellen**, mit einer Quote zum Sortieren. Also nicht „wie viele
der 765 Positionen hat der Betrieb bezogen", sondern „welcher Anteil seiner
Ausgaben entfällt auf Artikel, die auf keiner Liste stehen".

Der Unterschied ist nicht kosmetisch. Die Erfüllungslesart wurde gemessen und
verworfen: sie füllte die Rangliste mit geschlossenen und insolventen Häusern,
weil ein Betrieb mit wenigen Bestellungen zwangsläufig wenige Pflichtartikel
bezieht. Der Ausgabenanteil normiert das von selbst.

**Auf Ausgaben gerechnet, nicht auf Artikelzahl.** Eine Palette Fremdbier wiegt
mehr als eine Packung Zahnstocher. Dieselbe Entscheidung wie bei
`mart.fremdeinkauf`.

**Entschieden: Gültigkeit wird geführt und geschnitten.** Die Wilma-Wunder-Liste
ist ausdrücklich eine Sommerkarte (START 13.04.2026, ENDE 04.10.2026); Aposto
und Enchilada nennen nur „2026". Jede Bestellposition wird gegen die Liste
geprüft, die **am Bestelltag** galt. Eine Januarbestellung gegen die Sommerkarte
zu prüfen misst die Karte und nicht den Betrieb.

*Verworfen: Gültigkeit nur dokumentieren.* Wäre einfacher gewesen, hätte aber
die Wilma-Zahlen unlesbar gemacht — sie stünden dann für einen Zeitraum, in dem
die Vorgabe teilweise gar nicht galt.

*Verworfen: Zeitraum fest auf die Gültigkeit ohne jeden Filter.* Ist fachlich
dasselbe und wurde umgesetzt; der Unterschied ist nur, dass die Seite bewusst
**keinen** Zeitraumfilter anbietet, statt einen anzubieten, der den Schnitt
aufweichen würde.

**Entschieden: Namensabgleich zusätzlich zum Nummernabgleich.** 112 der 765
Positionen tragen keine Artikelnummer — überwiegend GFGH-Getränke („Pepsi Cola",
„Granini Apfelsaft naturtrüb"), weil jeder Betrieb seinen eigenen regionalen
Getränkefachgroßhandel mit eigenem Nummernkreis hat. Die Händler stehen in
FoodNotify (Getränke Keller, HFS, GLH, Trinkkontor), nur die Nummern passen
nicht. Für sie ist der Name der einzig mögliche Nachweis.

**Aber in zwei getrennten Zuständen, nicht in einem.** Der Namensabgleich trifft
zwei sehr verschiedene Fälle, und sie zusammenzuwerfen wäre der eigentliche
Fehler gewesen:

| Fall | Zustand | zählt als |
|---|---|---|
| Listenposition **ohne** Nummer, Name trifft | `pflicht_namentlich` | erfüllt — es gibt keinen anderen Nachweis |
| Listenposition **mit** Nummer, Name trifft, Nummer weicht ab | `namensgleich` | **weder noch** — Verdacht auf Nachfolgenummer |

Dieselbe Begründung wie bei `ampel.gesamt()` in `0080` und der
Lieferantenfreigabe in `0055`: ein Zustand, der „wir wissen es nicht" bedeutet,
darf nicht in den Topf fallen, der „in Ordnung" oder „Verstoß" heißt.

**Entschieden: Nachfolgenummern werden gepflegt, nicht geraten.** Artikelnummern
wechseln, während die Liste stehen bleibt: „Cheddar / Gouda Mix" lief bis
13.11.2025 unter Distra `268` und läuft seit 15.11.2025 unter `500096` — gleicher
Name, gleiches Gebinde, 105.194 € bei 20 Betrieben. Die Liste des Fachbereichs
zu korrigieren hätte die Vorlage verfälscht; den Namenstreffer automatisch als
erfüllt zu werten hätte geraten. Stattdessen `manual.pflichtartikel_alias`,
gefüllt über `pflege/pflichtartikel_alias.csv`, gespeist aus
`mart.pflichtartikel_verdacht`.

**Entschieden: Deutsche Konzepte bleibt außen vor.** Für die Marke liegt keine
Liste vor. Ohne Ausschluss stünde sie mit 100 % „abseits" in jeder Rangliste —
das wäre keine Aussage, sondern eine fehlende Datei.

**Entschieden: regionale Gerichte gelten nur, wo die Vorlage sie nennt.** 24
Artikel der Wilma-Wunder-Küchenliste tragen eine Ortsangabe in Klammern
(„Sauerbraten (Dresden, Köln, Düsseldorf)"). In der **Abdeckung** zählen sie nur
bei den genannten Betrieben — für Passau ist ein Dresdner Sauerbraten kein
fehlender Artikel. In der **Quote** gelten sie dagegen für alle als freigegeben:
wer sie kauft, kauft nicht abseits. Was sich nicht auflösen lässt, steht in
`mart.pflichtartikel_regional_offen` und gilt vorsorglich für alle — lieber ein
Treffer zu viel auf der Arbeitsliste als einer, der still verschwindet.

**Entschieden: eigene Seite, kein Reiter auf `db_einkauf`.** Anders als bei
`db_fremdeinkauf` ist es hier nicht eine andere Quelle (beide stehen auf
FoodNotify-Bestellungen), sondern eine andere **Frage**: `db_einkauf` fragt, was
der Einkauf kostet, `db_pflichtartikel` fragt, ob gekauft wird, was gekauft
werden soll. Auf einer Seite hätten die Zahlen nebeneinandergestanden, ohne dass
eine die andere erklärt. Dazu eine Kachel auf ③ Betrieb, direkt neben der
Fremdeinkaufskachel — die beiden ergänzen sich und werden leicht verwechselt:
Fremdeinkauf fragt, ob der **Lieferant** freigegeben ist, Pflichtartikel fragen,
ob der **Artikel** auf der Liste steht. Ein Betrieb kann beim freigegebenen
Lieferanten am Sortiment vorbei bestellen, und genau dieser Fall ist auf der
Fremdeinkaufsseite unsichtbar.


---

## 22.08.2026 — Pflichtartikel: die erste Rückmeldung des Fachbereichs

**Zwei Posten, die gleich aussahen, und gegensätzlich entschieden wurden.** Auf
der frisch übernommenen Seite standen bei Wilma Wunder Kaffee und Fassbier ganz
oben im „abseits"-Topf. Die Antwort:

**Bier und Wein sind ausdrücklich die Wahl des Betriebs** („Augustiner kein
Muss"). Das bestätigt, was die Vorlage selbst schon sagte und niemand gelesen
hatte: die Wilma-Wunder-Bar-Liste führt einen Abschnitt „Individueller Wein &
Bier" **ohne einen einzigen Artikel**. Diese Einkäufe erscheinen zwangsläufig als
Abweichung und sind keine.

*Verworfen: Getränke aus der Quote herausrechnen.* Wäre die bequeme Lösung und
die falsche — die Quote misst den Anteil am Einkauf, und Bier ist Einkauf. Wer
sie kleinrechnet, macht sie unvergleichbar mit den anderen Konzepten. Stattdessen
steht die Einordnung jetzt im Textblock der Seite und in den Beschreibungen der
Karten, die die Quote zeigen.

**Kaffee ist dagegen Pflicht** („Hornig muss"). Der Artikel stand schlicht nicht
auf der Liste, obwohl 14 von 14 aktiven Betrieben ihn beziehen — 98.937 € im
Laufzeitraum. Nachgetragen als eine Zeile in `pflege/pflichtartikel.csv`
(J.J. Darboven `1913002`), ohne Migration. Die Wilma-Wunder-Quote fällt damit von
32,0 auf 29,4 %.

**Nicht nachgetragen: Hornig Röstmeister Espresso (`1842001`).** Nur 2 von 14
Betrieben. „Hornig muss" meint den Hauskaffee, nicht jede Hornig-Nummer; ihn
einzutragen hätte zwölf Betriebe fälschlich als „Pflichtartikel fehlt" gemeldet.
Die übrigen Darboven-Artikel (Zuckersticks 14/14, Kaffeesahne 11/14, Gebäck 7/14)
stehen als Anschlussfrage in `offene-punkte.md` — bei 14/14 wäre ein Nachtrag
risikolos, bei 7/14 nicht, und geraten wird hier nicht.

**Die Lehre, und sie gehört auf die Seite:** ein großer Posten im „abseits"-Topf
ist eine **Frage** an den Fachbereich, keine Antwort. Zwei optisch identische
Fälle, zwei gegensätzliche Entscheidungen — und beide Male hätte die Auswertung
allein danebengelegen.


## 24.08.2026 — Bounti: fünf Festlegungen beim Anbinden

Anlass ist Eugenes Auftrag, Bounti anzubinden, und die Rückfrage, ob die Anforderung
überhaupt bekannt ist. Sie ist es: `examples/Umsetzung Berichte (1).xlsx` führt auf der
Ebene *Laden* die Berichte **„E-Learning erfolgreiche Kurse"** und **„Fluktuationsraten"**,
die Projektbeschreibung verlangt *„die Mitarbeiterqualifikation muss durch Bounti übergeben
werden"*, und `datenlage-round-table.html` nennt die fünf Felder für Kapitel 4.1/4.2. Der
Abgleich Punkt für Punkt steht in `bounti-api-inventar.md` §4.

### B1 — Es wird ausschließlich gelesen, und zwar durch fehlenden Code

Von 29 Pfaden schreiben 22. Darunter `DELETE /employees/{id}`, `PATCH /company` und
`POST /notifications` — Push-Nachrichten an alle Mitarbeitenden. `src/bounti/client.ts` kennt
deshalb **keine andere Methode als GET**; es gibt keinen Parameter, über den versehentlich
ein POST entstehen könnte.

Das ist bewusst schärfer als bei Yext, wo `yextHolen()` einen Körper annimmt (der
Analytics-Bericht ist ein POST, obwohl er liest). Bei Yext ist die schlimmste Folge eine
falsche Zahl. Hier wäre sie eine Nachricht auf hundert Telefonen.

### B2 — Name und Vorname werden gespeichert, E-Mail und Telefon nicht

Deckung durch die Entscheidung vom 13.08.2026 (*„Personenbezug: die Linie verschiebt sich,
und zwar begründet"*): mit der Round-Table-Map gibt es den Zweck, den es vorher nicht gab,
und Kapitel 4.2 verlangt die Zuordnung ausdrücklich **je Mitarbeiter**. Eine überfällige
Pflichtschulung ohne Namen ist eine Zahl, mit der niemand etwas tun kann.

`email`, `phone` und die Werte aus `customFields` bleiben draußen — für keine Kennzahl nötig.
Dieselbe Linie wie bei `core.bewertung`, wo `authorName` steht und `authorEmail` fehlt.

**Ausnahme mit Zweck:** aus `customFields` werden die **Feldnamen** und ihre Belegungszahl
mitgeschrieben (`core.bounti_feldname`), nie die Werte. Grund: läge dort eine Personalnummer,
die auch LINA kennt, wäre das die Brücke, an der Kapitel 4.2 heute scheitert — LINAs
Mitarbeiterstammdaten sind für unseren Zugang gesperrt. Die Frage ist so beim ersten echten
Lauf beantwortet, ohne unbesehen Freitextfelder zu importieren.

### B3 — Zuweisungen laufen in Rotation, nicht auf Befehl

`/{courses|paths}/{id}/assignments` kennt **keinen Zeitfilter** — kein `after`, kein
`updatedAt`. Inkrementell geht nur `/audits/reports`, der einzige Endpunkt der ganzen
Schnittstelle mit `after`/`before`.

Damit gab es zwei Wege: ein Handbefehl, der den Bestand gelegentlich geradezieht, oder eine
Obergrenze im Nachtlauf. Die Entscheidung vom 14.08.2026 (*„Betrieb ohne Handbefehl"*) gilt
weiter und ist hier zum ersten Mal von Anfang an eingebaut: `BOUNTI_LERNEINHEITEN_JE_LAUF`
(Vorgabe 40) arbeitet je Nacht die am längsten nicht geholten ab, nie geholte zuerst. Der
Rückstand steht in `mart.bounti_zuweisung_stand` und **muss von Nacht zu Nacht fallen** —
`/status` schlägt an, wenn er neben einem frischen Merker stehen bleibt.

### ~~B4 — Fluktuation wird mitgeschrieben, nicht abgefragt~~ → **revidiert am 24.08.2026**

> **Die Überschrift war falsch, und zwar in der Sache.** Eugene hat noch am selben Tag
> nachgefragt, ob die Fluktuationsrate nicht aus LINA komme. Sie kommt aus LINA.
>
> `kennzahlen-mapping.md` führte eine Zeile *„Fluktuationsraten, E-Learning | Team / Bounti"* —
> **zwei** Kennzahlen mit **zwei** Quellen in paarweiser Reihenfolge: Fluktuation → *Team*
> (LINA), E-Learning → *Bounti*. In `examples/Umsetzung Berichte (1).xlsx` sind es ohnehin zwei
> getrennte Berichte, und der entscheidende Unterschied steht in derselben Datei: „E-Learning
> erfolgreiche Kurse" hat *Status Bericht = 0*, **„Fluktuationsraten" hat *Status Bericht = 1*** —
> den Bericht gibt es in LINA also bereits.
>
> Eintritt und Austritt stehen in **Team > Mitarbeiter > Stammdaten**
> (`/personal/mitarbeiter/manageusers`); der genutzte Zugang hat darauf `access:false`
> (`lina-api-inventar.md` §5). Das ist eine **Rechtefrage**, kein Datenmangel — und sie stand
> längst in `offene-punkte.md` unter *Mitarbeiter-Stammdaten*, dort nur mit Kapitel 4.2
> begründet.
>
> **Erster Reparaturversuch — und warum er nicht reichte.** Zunächst blieb die gebaute
> Momentaufnahme stehen und wurde nur beschriftet: Spalte `abgangsquote_pct` statt
> `fluktuation_pct`, Sichtkommentar beginnend mit „DAS IST NICHT DIE FLUKTUATIONSRATE".
> Eugenes Antwort darauf war der eigentliche Punkt: *„Das macht keinen Sinn und verwirrt."*
>
> **Er hat recht, und die Regel dahinter steht seit `0029` im Haus.** Damals ist
> `mart.pruefung_wareneinsatz` stillgelegt worden, statt sie „ungefähr" stehen zu lassen.
> Eine Zahl, die *fast* richtig aussieht, ist teurer als eine, die fehlt: die fehlende fällt
> auf, die fast richtige wird verwendet — und keine Beschriftung überlebt den Weg in eine
> Präsentation. Ein Warnhinweis an einer Kennzahl ist kein Ersatz dafür, sie nicht zu bauen.
>
> **Also entfernt**, bevor die Migration irgendwo angewendet war: `core.bounti_mitarbeiter_stand`
> und `mart.bounti_personal_monat` gibt es nicht mehr, die Fortschreibung im Lader auch nicht.
> `core.bounti_mitarbeiter` bleibt — die Schulungsauswertung braucht die Person als Schlüssel
> und ihre Standortzuordnung.
>
> **Und der Befund, der die Sache endgültig entscheidet, lag längst im Haus** — nur in einer
> anderen Datei: `lina-api-inventar-ladenakte.md` §4 e), Erhebung vom 11.08.2026. **Bounti
> hält einen LINA-API-Schlüssel mit dem Scope *Personalstammdaten und Kosten*.** Bounti liest
> die Personaldaten also aus LINA. Sie aus Bounti zurückzurechnen hieße, eine Kopie gegen ihr
> Original zu messen.
>
> **Was stattdessen passiert:** die Herkunft wird gemessen, nicht geraten. `access: false`
> stammt vom 25.07.2026 und von der **Konzernebene** — derselben, die auch für BWA und Belege
> HTTP 500 liefert, während die Ladenakte je Betrieb beides herausgibt. Ob es hier ebenso ist,
> hat nie jemand geprüft. Dafür gibt es seit heute `bun run lina-fragen d10`: ein lesender
> Aufruf, der entscheidet, ob es eine Aufwands- oder eine Rechtefrage ist — und die ginge an
> **Concept Family**, deren Administrator die API-Schlüssel selbst anlegt, nicht an LINA
> (Entscheidung vom 11.08.2026 bleibt unberührt).

**Der ursprüngliche Wortlaut, durchgestrichen, weil die Konstruktion hier nicht mehr steht:**

~~Bounti liefert weder Eintritts- noch Austrittsdatum. `core.bounti_mitarbeiter_stand` schreibt
deshalb je Lauf den laufenden Monat fort, eine Zeile je Person, Monat und Standort — dieselbe
Konstruktion wie die `*_stand`-Tabellen aus `0002`.~~

**Der Preis ist genannt statt verschwiegen:** die Reihe beginnt am Tag der Anbindung. Der
erste Monat trägt `datenbasis = 'erster Monat'` und **keine Rate**, weil dort jede Person ein
Zugang und niemand ein Abgang ist. Dieselbe Überlegung wie bei `mart.pflichtartikel_abdeckung`
(`0095`): „hat nichts bestellt" ist nicht „hat alles vergessen".

### B5 — Die Auditnote geht NICHT in die Ampel

`LOCATION_AUDIT` ist eine bewertete Begehung eines Betriebs mit Punktzahl — die erste
objektive Betriebsnote aus einem Fachsystem. `manual.om_einschaetzung`, die subjektive Note
des Operations Managers, ist seit Juli 2026 leer (`0079`). Der Ersatz liegt so nahe, dass er
ausgesprochen gehört.

**Und er wird trotzdem nicht gebaut.** `ampel.gesamt()` bleibt unberührt,
`mart.bounti_audit_betrieb_monat` steht daneben. Eine Auditnote misst etwas anderes als eine
OM-Einschätzung — sie hängt an einem Fragenkatalog, den jemand entworfen hat, und an der
Frage, wer wie oft auditiert. Ob sie die OM-Note ersetzt, ergänzt oder danebensteht,
entscheidet der Fachbereich; die Frage steht in `offene-punkte.md`.

Begründung ist Migration `0080`: dort ist die Ampel ausdrücklich um einen vierten Zustand
erweitert worden, damit ein **fehlendes** Signal nicht mehr als grün durchfällt. Ein Signal
still durch ein anderes zu ersetzen, wäre derselbe Fehler von der anderen Seite.

### Was daran nicht entschieden ist

~~Diese Anbindung ist gegen die OpenAPI-Spezifikation gebaut und nie gegen die echte
Schnittstelle gelaufen~~ → **am 24.08.2026 nachgeholt.** Der Zugang steht, der erste volle
Lauf ist durch, die Messwerte stehen in `bounti-api-inventar.md` §8. Die wichtigste offene
Annahme hat sich bestätigt: die 28 Rollen sind echte **Bereiche** (Bar, Küche, Service,
Spülküche …), die Auswertung je Bereich ist damit möglich.

Zwei Annahmen sind gefallen: `customFields` ist **leer** — es gibt keinen gemeinsamen
Schlüssel mit LINA — und der Katalog ist mit 470 Lerneinheiten so groß, dass die Rotation von
40 auf 120 je Nacht angehoben werden musste.

---

## 24.08.2026 — Bounti: vier Festlegungen beim Auswerten

Migration `0097` und `metabase/karten-bounti.ts`. Die Anbindung stand, die Frage war,
**wie** die Zahlen gezeigt werden. Vier Entscheidungen, die sich später teuer korrigieren
ließen.

### B6 — Stand heute statt Stichmonat, und der Monatsfilter wird ausgelassen

Alle anderen Fach-Dashboards hängen am Monatsfilter des Round Table. Die Bounti-Karten
tun es nicht: sie zeigen den **Stand von heute** und lesen `{{monat}}` überhaupt nicht.

„Überfällig" ist eine Aussage über heute. Rechnet man sie in den Monat der Zuweisung
zurück, steht eine täglich steigende Zahl unter einem abgeschlossenen Monat — und sie
ändert sich nach dessen Ende weiter. Das ist keine Ungenauigkeit, sondern eine Zahl, die
etwas anderes behauptet als sie misst.

**Der Preis dieser Entscheidung ist Erklärungsarbeit.** Auf ① stehen die Kacheln neben
monatsgefilterten und sehen genauso aus. Deshalb: 22 Einträge in `FILTER_AUSNAHME` mit
einzelner Begründung, und — wichtiger — **jede Seite sagt es in ihrer Überschrift**. Eine
stumme Ausnahme wäre hier schlimmer als der fehlende Filter.

Die einzige Karte mit Zeitachse trägt ihr Fenster selbst und zeigt den Monat der
**Zuweisung**, nicht den des Abschlusses — sonst verschwände die nie erledigte
Pflichtschulung aus der Statistik, also genau der Fall, um den es geht.

### B7 — Die Leitsicht geht von `core.betrieb` aus, nicht von Bounti

`mart.bounti_betrieb_stand` führt **alle 141 Betriebe**, auch die 79 ohne Bounti-Standort,
mit leeren Zahlen und der Spalte `in_bounti`.

Andersherum gebaut wäre die Sicht kürzer und falscher: eine Liste von 62 Betrieben sieht
aus wie der Konzern. Der Unterschied zwischen „dort ist nichts offen" und „wir wissen
nichts über diesen Betrieb" betrifft mehr als die Hälfte der Zeilen — und acht davon sind
operative Betriebe mit Umsatz.

Dasselbe Muster wie `mart.bounti_ohne_betrieb` in `0096`, nur in der Auswertung statt in
der Überwachung: Regel 10 verlangt, dass eine Quelle ohne Zufluss **in der Datenbank**
sichtbar ist, nicht nur in einem Log.

### B8 — Die leere Audittabelle wird gebaut und bleibt stehen

`bo_audit_betrieb` liefert am Tag ihrer Entstehung **null Zeilen**: alle 133 Auditberichte
hängen an drei Standorten ohne Betriebszuordnung.

Sie wegzulassen wäre naheliegend gewesen. Eine weggelassene Karte sieht aber aus wie eine
Frage, die niemand gestellt hat; eine leere mit erklärender Beschreibung ist eine Frage
mit Adresse. Daneben steht `bo_audit_liste`, die **alle** Berichte führt, auch die ohne
Betrieb, mit „— kein Betrieb zugeordnet" in der Betriebsspalte.

Dieselbe Überlegung wie bei `rt_kachel_ohne_urteil`: ein Betrieb ohne BWA sah im Excel aus
wie ein Betrieb ohne Befund.

### B9 — „Ohne Frist" ist ein eigener Zustand, kein Sonderfall von „offen"

`zustand` in `mart.bounti_schulung_person` hat vier Werte: `abgeschlossen`, `ueberfaellig`,
`offen`, `ohne Frist`.

**Die Reihenfolge der `CASE`-Zweige ist Teil der Entscheidung: abgeschlossen gewinnt vor
ohne-Frist.** Eine erledigte Zuweisung ohne Frist zählt als erledigt und nicht als
Sonderfall. `ohne Frist` heißt deshalb **offen und ohne Frist**.

Das sind zwei verschiedene Zahlen, und der erste Wurf dieser Karten hat sie verwechselt:
**29.513 der 74.683 Zuweisungen tragen überhaupt kein Fälligkeitsdatum (39,5 %) — davon
sind aber 21.505 längst abgeschlossen.** Offen und ohne Frist bleiben 8.008, in operativen
Betrieben 5.832 von 57.984 (10,1 %). Die Kachelbeschreibung sagte zuerst „rund 40 %" neben
einer Kachel, die 5.832 zeigt. Beide Zahlen stimmen für sich, zusammen sind sie falsch.

Offen und ohne Frist kann nie überfällig werden. Wer es unter „offen" mitzählt, hält einen
Betrieb für säumig, der nichts versäumt hat. Und je größer die Zahl, desto weniger misst
die Erfüllungsquote: ohne Frist ist „noch nicht gemacht" von „zu spät" nicht zu
unterscheiden. Deshalb hat der Zustand eine eigene Kachel und steht in jeder
Betriebstabelle als eigene Spalte.

### Was daran nicht entschieden ist

Ob die **Auditnote** die Vor-Ort-Note im Round Table ersetzt — siehe B5, unverändert offen.

Ob die **Erfüllungsquote** ein siebtes Ampelsignal wird. Sie steht auf ① unter der
Betriebstabelle und mit eigener Überschrift, ausdrücklich außerhalb der Ampel. Der Platz
ist bewusst gewählt: zwischen den Ampelkacheln hätte sie die Bedeutung der Ampel still
verschoben.

Was mit den **26 Standorten ohne Betrieb** geschieht. Bei sechzehn ist die Antwort
„nichts" (Fremdmandant, unbekannte Häuser), bei sechs steht dieselbe Entscheidung aus wie
bei Yext. Die Liste steht jetzt als `mart.bounti_standort_offen` mit Gewicht statt als
einmalige Recherche in einem Dokument — siehe `offene-punkte.md`.
