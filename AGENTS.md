# Concept Family Analytics

Automatisierte Auswertungen für **Concept Family AG** auf Basis des Kassensystems **LINA TeamCloud**.
Ersetzt die manuelle Pflege der Round-Table-Excel-Dateien durch eine eigene Datenhaltung.

**Kette:** LINA (`app.lina.de`) → Importer (Bun/TypeScript) → PostgreSQL 18 → Metabase

---

## Für Agents: erst lesen, dann arbeiten

Diese Datei ist der Einstieg. Die inhaltliche Wahrheit steht in `docs/`.
**Bevor du am Importer oder am Schema arbeitest, lies mindestens `docs/lina-api-korrekturen.md` und `docs/entscheidungen.md`** — dort stehen die Befunde, die drei frühere, plausibel klingende Annahmen widerlegt haben.

### Harte Regeln, die nicht verhandelbar sind

1. **In LINA wird ausschließlich gelesen.** Nichts anlegen, ändern, speichern oder löschen. Keine Favoriten speichern, keine Report-Konfiguration ändern, keine Formulare absenden. Im Zweifel vorher fragen.
2. **Zugangsdaten kommen aus Umgebungsvariablen** und werden nie geloggt, nie persistiert, nie committet.
3. **Das Anfragetempo ist Teil der Anforderung, keine Höflichkeit.** Es gibt keinen offiziellen Zugang und keine dokumentierten Limits — die Drosselung ist das, was die Integration am Leben hält. Werte in `src/config.ts` nur mit Begründung erhöhen.
4. **Der Raw-Layer ist die Versicherung.** `raw.api_antwort` ist append-only. Niemals `UPDATE` oder `DELETE`. Alles in `core` darf jederzeit daraus neu aufgebaut werden.
5. **Prozentwerte sind immer Prozentzahlen** (`23.64`), nie Brüche (`0.2364`). Das Excel macht es andersherum — das ist die häufigste Fehlerquelle.
6. **Anmeldefehler werden nie in einer Schleife wiederholt.** Falsche Zugangsdaten mehrfach zu senden ist der schnellste Weg zu einer Kontosperre — und es gibt nur diesen einen Zugang.
7. **Die Browserkennung bleibt stimmig.** Wer `LINA_USER_AGENT` ändert, ändert damit auch die Client-Hints (die Version wird daraus gelesen). Eine Chrome-Kennung ohne `sec-ch-ua`/`sec-fetch-*` gibt es bei keinem echten Browser und fällt mehr auf als gar keine Kennung. Begründung in `docs/importer.md`.

### Namenskonvention

**Fachbegriffe kommen aus LINA und bleiben deutsch:** Betrieb, Konzept, Umsatz, Wareneinsatz, BWA, Ampel, Hauptsparte, Verkaufsstelle, Geschäftstag. Wo LINA einen Bericht so nennt, heißt die Tabelle auch so (`getUmsatzbericht` → `core.umsatzbericht_tag`). Damit ist die Zuordnung ohne Übersetzungsschritt lesbar — und genau da entstehen sonst Fehler.

**Englisch bleiben nur die Schichtnamen:** `raw`, `core`, `manual`, `ampel`, `sync`, `mart`. Das sind Architekturbegriffe, keine LINA-Begriffe.

Kommentare sind deutsch, damit sie in Postico lesbar sind.

---

## Was wo steht

### `docs/` — Wissen

| Datei | Inhalt | Wann lesen |
|---|---|---|
| **`lina-api-inventar.md`** | Alle LINA-Endpunkte: Parameter, Antwortstrukturen, Auth, Zeitverhalten. Ergebnis der Exploration. | Immer, wenn du einen Endpunkt anfasst |
| **`lina-api-inventar-1b.md`** | Nachtrag: das **zweite** Report Center auf Betriebsebene (72 Berichte), WAWI, Dienstplan, Finance | Wenn du über die sieben Konzern-Berichte hinaus willst |
| **`lina-api-korrekturen.md`** | **Wichtig.** Drei widerlegte Annahmen und ein gelöster Blocker. Überschreibt die beiden Dateien darüber, wo es abweicht. | Vor jeder Arbeit an Kennzahlen oder Betriebs-Reports |
| **`kennzahlen-mapping.md`** / `.csv` | Excel-Kennzahl → LINA-Endpunkt/Feld → offene Fragen. Die eigentliche Zieldefinition. | Wenn du eine Kennzahl baust oder prüfst |
| **`architektur.md`** | Warum Hetzner + Dokploy + vanilla Postgres. Verworfene Alternativen mit Begründung. | Vor Infrastrukturänderungen |
| **`datenmodell.md`** | Schema-Entscheidungen und ihre Begründung | Vor Schemaänderungen |
| **`importer.md`** | Aufbau des Importers: Warteschlange, Drosselung, Session, Transformationen | Vor Arbeit an `src/` |
| **`backfill.md`** | Strategie und Rechnung für die Historie | Wenn du Zeiträume einreihst |
| **`entscheidungen.md`** | Entscheidungsprotokoll, chronologisch, inklusive der revidierten | Wenn du dich fragst „warum eigentlich so" |
| **`protokoll-anmeldeverfahren.md`** | Wie LINAs Anmeldung funktioniert, was das sicherheitstechnisch bedeutet, und was daraus folgt | Bevor du an `auth.ts` arbeitest oder jemand nach dem Passwortumgang fragt |
| **`datensicherung.md`** | Welche Rohdaten wir sichern sollten, solange LINA erreichbar ist — nach Wert und Kosten sortiert | Wenn du über neue Endpunkte oder Backfill-Tiefe entscheidest |
| **`offene-punkte.md`** | Was ungeklärt ist und wer es klären muss | Bevor du etwas als fertig meldest |
| **`payloads/`** | Echte, anonymisierte LINA-Antworten aus der Exploration | Als Referenz; identisch mit den Test-Fixtures |

### `examples/` — die Quelle der Anforderung

Die heute manuell gepflegten Excel-Dateien. **`JULI_Round_Table_Ampelsystem.xlsx` ist die verbindliche Zieldefinition** — `mart.round_table()` bildet dessen Blatt „Eingabe" nach und ist gegen die Zeile „Enchilada Bayreuth" verifiziert. Dazu die Screenshots aus dem Strategiemeeting und die Projektbeschreibung.

### `migrations/` — Datenbankschema

Handgeschriebenes SQL, nummeriert, wird der Reihe nach angewendet. Bewusst handgeschrieben und kein ORM-Generat: Partitionierung, BRIN-Indizes, `UNIQUE NULLS NOT DISTINCT`, Views und PL/pgSQL-Funktionen lassen sich in einem ORM nicht ausdrücken — und genau die tragen hier die Fachlogik. Der Importer greift über `node-postgres` mit einfachem SQL zu, ohne ORM-Schicht.

| Datei | Inhalt |
|---|---|
| `0000_schema.sql` | Schemata, Tabellen, Kommentare, Seed-Daten |
| `0001_logik.sql` | Partitionen, Ampel-Funktionen, Mart-Sichten, `mart.round_table()` |
| `0002_zeit.sql` | Geschäftstag, Zeitzonenumrechnung, LINA-Epoch-Wächter |
| `0003_warteschlange.sql` | Arbeitsschlange des Importers |
| `0004_konzept.sql` | Markenebene: Hauptkonzept, Markenschnitt, Round Table mit doppeltem Maßstab |
| `0005_konzept_korrektur.sql` | Korrigiert die n:m-Aussage aus `0000` und hält den Prüfstand fest |
| `0006_pruefung.sql` | Gegenrechnung: LINAs Aggregate gegen eigene Neuberechnung |
| `0007_artikel_historie.sql` | `core.artikel_stand` — Artikelstand je Monat statt Momentaufnahme |
| `pruefung.sql` | Verifikation gegen den Bayreuth-Fall aus dem Excel |

Migration hinzufügen: neue Datei `NNNN_name.sql`, aufsteigend. **Bereits angewendete Dateien nie ändern** — der Stand steht in `public.schema_migration`.

### `src/` — Importer

```
config.ts              Umgebungsvariablen, beim Start geprüft
db/pool.ts             node-postgres, Typumwandlungen, Transaktionen
db/migrate.ts          Migrations-Runner
lib/time.ts            Zeitumrechnung an der LINA-Grenze
lib/log.ts             strukturiertes Logging
lina/auth.ts           Anmeldung und Sessionpflege, Browserkennung
lina/client.ts         gedrosselter Client, Fehlerklassifikation
lina/endpunkte.ts      Berichtsregister — neue Berichte sind ein Eintrag
lina/schemas.ts        zod je Endpunkt, erkennt Strukturänderungen
lina/mock.ts           LINA-Attrappe für die Tests — bildet auch den
                       echten Anmeldeablauf nach, nicht einen bequemen
sync/worker.ts         die Schleife
sync/laden.ts          raw → core
transform/index.ts     reine Transformationsfunktionen
health.ts              Health-Endpunkt, hält den Container oben
sync.ts / einreihen.ts Einstiegspunkte
```

---

## Befehle

```bash
bun install
bun run migrate                              # Schema anwenden (idempotent)
bun test                                     # 48 Tests
bun run einreihen --taeglich                 # gestrigen Geschäftstag einreihen
bun run einreihen --historie --von 2018-01-01 --bis 2026-07-24
bun run sync                                 # einen Lauf abarbeiten
bun run health                               # Health-Endpunkt (Container-CMD)
bun run typecheck
```

Für den Ende-zu-Ende-Test zusätzlich `TEST_DATABASE_URL` setzen — ohne die Variable wird er übersprungen.

> **Der Ende-zu-Ende-Test löscht Daten.** Sein `beforeAll` macht `TRUNCATE` über `core`, `raw` und `sync`. Er gehört deshalb auf eine **eigene** Datenbank und wird **einzeln** gestartet:
>
> ```bash
> createdb lina_test
> DATABASE_URL=postgresql://postgres@localhost/lina_test bun run migrate
> TEST_DATABASE_URL=postgresql://postgres@localhost/lina_test bun test src/sync/e2e.test.ts
> ```
>
> **Nicht im Gesamtlauf `bun test`.** `bun test` teilt die Modulregistrierung über Testdateien hinweg: `config` wird einmal geladen und friert die Umgebung der zuerst gelaufenen Datei ein — also die `.env`. Der Worker schriebe dann in die **echte** Datenbank, während der Test gegen die Testdatenbank prüft. Beide Fälle brechen seit dem 25.07.2026 mit einer klaren Meldung ab, statt still Daten zu vernichten.

---

## Betrieb

**Dokploy auf einem Hetzner-Server.** Postgres als *Managed Database* (die geplanten S3-Backups sind eingebaut, Ziel ist Bunny Storage — anderer Anbieter, andere Ausfalldomäne). Der Importer als *Application* aus dem GitHub-Repo mit Build-Typ **Dockerfile**, nicht Nixpacks.

Dokploys Schedule Jobs führen Kommandos per `docker exec` in einem **laufenden** Container aus; sie starten keinen neuen. Deshalb hält `health.ts` den Container oben, und der Job ruft `bun run sync` als eigenen Prozess auf. Jeder Lauf startet damit frisch, und man bekommt pro Lauf einen Log-Eintrag samt manueller Auslösung.

Zwei Schedule Jobs:

```
täglich  06:30   bun run einreihen --taeglich
stündlich       bun run sync
```

Der Sync läuft **tagsüber** (Fenster 7–23 Uhr, konfigurierbar). Das ist Absicht: ein einzelner Client um drei Uhr früh ist im Log ein Ausreißer, dieselben Anfragen im Tagesverkehr von 141 Betrieben fallen nicht auf.

**Postgres nie ins Internet exponieren** — Postico über SSH-Tunnel.

---

## Wo man nachschaut, wenn etwas klemmt

Alles in Postico, keine Log-Wühlerei nötig:

```sql
SELECT * FROM mart.sync_status LIMIT 5;              -- letzte Läufe
SELECT * FROM mart.warteschlange_stand;             -- Backfill-Fortschritt je Endpunkt
SELECT * FROM sync.aufgabe ORDER BY aufgabe_id DESC LIMIT 50;
SELECT * FROM sync.schema_abweichung WHERE quittiert_am IS NULL;
SELECT * FROM sync.warteschlange WHERE letzter_fehler IS NOT NULL;
```

Nach jedem größeren Backfill zuerst:

```sql
SELECT * FROM mart.pruefung_uebersicht;   -- rechnet LINAs Aggregate gegen unsere Artikeldaten nach
```

**`sync.aufgabe.status = 'keine_daten'` ist ein Normalzustand, kein Fehler.** LINA antwortet mit HTTP 500 und leerem Body, wenn ein Betrieb für einen Bericht keine Daten hat. Darauf darf nie ein Retry laufen.

Round Table erzeugen:

```sql
SELECT * FROM mart.round_table(DATE '2026-06-01');
SELECT * FROM mart.round_table(DATE '2026-06-01', 'lina_betrieb');
SELECT * FROM mart.round_table_vergleich(DATE '2026-06-01') WHERE weicht_ab;
```

Markenebene:

```sql
SELECT * FROM mart.konzept_schnitt(DATE '2026-06-01');
SELECT * FROM mart.round_table_marke(DATE '2026-06-01');
-- Arbeitsliste: wem fehlt noch die Marke?
SELECT * FROM mart.konzept_zuordnung WHERE hauptkonzept IS NULL;
```

**Der Betriebsname ist NICHT eindeutig.** In `getKennzahlen` liefert die Gruppe die Marke, das Kind nur die Stadt — fünf Betriebe heißen „Karlsruhe". Immer über `enc_id` joinen, nie über den Namen. Ob dahinter fünf Betriebe stehen (erwartet) oder ein Betrieb in fünf Marken, klärt: `SELECT anzahl_konzepte, count(*) FROM mart.konzept_zuordnung GROUP BY 1;` — Details in `migrations/0005_konzept_korrektur.sql`.

---

## Stand

| Phase | Status |
|---|---|
| 1 — Exploration | abgeschlossen |
| 2 — Datenmodell | abgeschlossen und freigegeben |
| 3 — Importer | gebaut, gegen LINA-Attrappe getestet, **noch nicht gegen das echte LINA gelaufen** |
| 4 — Metabase | offen |

Der erste Lauf gegen das echte LINA ist der nächste Schritt.

Ein erster Versuch scheiterte an der Anmeldung (`Login 200, Probe 302`). Der tatsächliche Ablauf ist inzwischen aus `/js/common/login.js` rekonstruiert und umgesetzt — POST auf `/common/index/dologin`, Passwort als MD5, dazu ein `secret` aus der Loginseite. Die Attrappe bildet ihn nach, `src/lina/auth.test.ts` deckt ihn ab.

**Für den nächsten Versuch:**

```bash
MAX_POSTEN_PRO_LAUF=1 bun run sync
```

Schlägt das fehl: **nicht wiederholen.** Die Fehlermeldung nennt die Prüfreihenfolge (Zugangsdaten → `LINA_SYSTEM` → `LINA_PASSWORD_HASH`). Was sonst noch offen ist, steht in `docs/offene-punkte.md`.
