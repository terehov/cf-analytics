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

---

## Drei widerlegte Annahmen aus der Exploration

Alle drei klangen plausibel und waren falsch. Details in `lina-api-korrekturen.md`.

1. **„Der Account sieht die BWA-Zahlen nicht"** — falsch. Verallgemeinerung aus einem einzigen Betrieb, der tatsächlich keine BWA hat. Es ist ein Datenverfügbarkeitsproblem, kein Rechteproblem. Der Blocker war keiner.
2. **„WE-% muss man aus POS-Sparten rechnen"** — falsch und gefährlich: ergibt 45,90 statt 23,64. `getKennzahlen?mode=relativ` liefert die Ampelwerte fertig.
3. **„Der Betriebswechsel ist die offene Architekturfrage"** — gelöst: `storeId=<encId>` als Parameter, kein Session-Wechsel nötig.
