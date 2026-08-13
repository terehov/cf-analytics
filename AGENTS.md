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
5. **LINAs Warenwirtschaft und Einkauf sind Demodaten.** Nicht importieren, nicht auswerten, nicht darauf verweisen. Waren, Lieferanten, Bestellungen und Inventuren kommen aus **FoodNotify** (`docs/plan-foodnotify.md`). Betrifft auch `core.artikel.fixer_we`: dessen Herkunft ist ungeklärt, `mart.pruefung_wareneinsatz` ist deshalb seit Migration `0029` stillgelegt (Begründung in `docs/entscheidungen.md`). Der theoretische Wareneinsatz in `mart.deckungsbeitrag_warengruppe` steht weiter auf `fixer_we` — als Umsatzgliederung brauchbar, **als Margenaussage nicht**. Auf `abdeckung_pct` sehen, bevor jemand daraus etwas ableitet.
6. **Prozentwerte sind immer Prozentzahlen** (`23.64`), nie Brüche (`0.2364`). Das Excel macht es andersherum — das ist die häufigste Fehlerquelle.
7. **Anmeldefehler werden nie in einer Schleife wiederholt.** Falsche Zugangsdaten mehrfach zu senden ist der schnellste Weg zu einer Kontosperre — und es gibt nur diesen einen Zugang.
7a. **Den Sync-Prozess nicht aus der Agentenumgebung gegen das echte LINA starten.** Am 26.07.2026 wurden vier Anmeldungen abgelehnt, obwohl Passwort, Felder und Header nachweislich stimmten — derselbe Befehl im Terminal des Nutzers meldete sich beim ersten Versuch an. Der Netzwerkweg der Agentenumgebung wird von LINA an der Anmeldung abgewiesen, mit der irreführenden Meldung „Benutzername oder Passwort ist falsch!". Migrationen, Tests gegen die Attrappe und Datenbankarbeit sind davon nicht betroffen. Wer den Import starten will: **den Nutzer bitten** (`bun run sync`) oder den Container. Hergang in `docs/protokoll-anmeldeverfahren.md`.
8. **Die Browserkennung bleibt stimmig.** Wer `LINA_USER_AGENT` ändert, ändert damit auch die Client-Hints (die Version wird daraus gelesen). Eine Chrome-Kennung ohne `sec-ch-ua`/`sec-fetch-*` gibt es bei keinem echten Browser und fällt mehr auf als gar keine Kennung. Begründung in `docs/importer.md`.
9. **Jeder Befund landet in `docs/`, bevor der Commit steht.** Eine Erkenntnis, die nur in einer Commit-Nachricht oder einem Code-Kommentar existiert, ist für den nächsten Agenten nicht auffindbar. Welche Datei wofür zuständig ist, steht unten unter *Dokumentationspflicht*.
10. **Eine Quelle ohne Zulauf ist ein Fehler, kein Normalzustand.** Der Lauf darf sie nicht als „ok" melden. Wer einen Zweig baut, der „nichts zu tun" bedeutet, macht ihn **sichtbar** — im Lauf, in einer Prüfsicht, im Dashboard. Nicht in einem Log: Logs liest niemand.
    Diese Regel hat dieses Projekt zweimal Tage gekostet, beide Male mit derselben Signatur. Am 02.08.2026 stand LINA acht Tage still, weil das Einreihen ein eigener Zeitplan war und ausfiel — der Sync lief fehlerfrei weiter. Am 12.08.2026 fror das Belegarchiv ein, weil seine Einreihbedingung die eines einmaligen Abzugs war; die Läufe 85 bis 88 meldeten 269 von 269 Aufgaben „ok" und holten null Belege. **Ein Importer ohne Arbeit sieht genauso aus wie einer, der fertig ist.** Der Unterschied muss in der Datenbank stehen, nicht im Kopf dessen, der zuletzt hingesehen hat.

### Namenskonvention

**Fachbegriffe kommen aus LINA und bleiben deutsch:** Betrieb, Konzept, Umsatz, Wareneinsatz, BWA, Ampel, Hauptsparte, Verkaufsstelle, Geschäftstag. Wo LINA einen Bericht so nennt, heißt die Tabelle auch so (`getUmsatzbericht` → `core.umsatzbericht_tag`). Damit ist die Zuordnung ohne Übersetzungsschritt lesbar — und genau da entstehen sonst Fehler.

**Englisch bleiben nur die Schichtnamen:** `raw`, `part`, `core`, `manual`, `ampel`, `sync`, `mart`. Das sind Architekturbegriffe, keine LINA-Begriffe.

**Drei Begriffe, die nicht vermischt werden dürfen** (seit Migration `0030`). Beide Quellsysteme sagen „Artikel" und meinen Verschiedenes:

| Tabelle | System | Bedeutung |
| --- | --- | --- |
| `core.artikel` | LINA | was **verkauft** wird — die Position auf dem Bon |
| `core.rezept` | FoodNotify | woraus ein verkaufter Artikel **besteht** |
| `core.ware` | FoodNotify | was **eingekauft** wird — Rohware, Zutat |

Verbunden werden sie über `core.pos_artikel`: `plu = core.artikel.artikelnummer`. **Dieser Join gilt nur, wo `core.kostenstelle.kassensystem = 'amadeus'`** — bei anderen Kassensystemen ist `plu` ein fremder Nummernkreis und trifft still falsche Artikel. Begründung und Messwerte in `docs/foodnotify-0-1-nummernraum.md`.

LINAs Tabellen heißen nach LINA-**Berichten** (`umsatzbericht_tag`), FoodNotifys nach **Fachbegriffen** (`rezept`, `ware`, `bestellung`). Deshalb kollidieren sie nicht.

Kommentare sind deutsch, damit sie in Postico lesbar sind.

---

## Was wo steht

### `docs/` — Wissen

| Datei | Inhalt | Wann lesen |
|---|---|---|
| **`datenherkunft.md`** | **Der Einstieg.** Woher jede Zahl kommt, welche Endpunkte aktiv sind, und vor allem: **wie die Tabellen zusammenfinden** — `encId` gegen numerische LINA-ID, `artnr` gegen `id`, Stände über Zeiträume. Dazu, was die Zahlen *nicht* sagen. | Bevor du irgendetwas joinst oder eine Zahl deutest |
| **`fehlerkatalog.md`** | **Jeder Fehler, den dieses Projekt gemacht hat** — Symptom, Ursache, was ihn heute verhindert. Fast keiner davon hat sich gemeldet: kein Stacktrace, nur eine plausibel aussehende falsche Zahl. | Einmal ganz, bevor du einer Zahl glaubst. Und immer, wenn etwas komisch aussieht |
| **`lina-api-inventar.md`** | Alle LINA-Endpunkte: Parameter, Antwortstrukturen, Auth, Zeitverhalten. Ergebnis der Exploration. | Immer, wenn du einen Endpunkt anfasst |
| **`lina-api-inventar-1b.md`** | Nachtrag: das **zweite** Report Center auf Betriebsebene (72 Berichte), WAWI, Dienstplan, Finance | Wenn du über die sieben Konzern-Berichte hinaus willst |
| **`lina-api-inventar-1c.md`** | **Im Browser verifiziert (25.07.2026).** Konzeptzuordnung ist 1:n, Personalberichte sind gesperrt, WAWI ist JSON, Sortimentshierarchie gefunden. Überschreibt 1a und 1b, wo es abweicht. | Bevor du einen Endpunkt aktivierst |
| **`lina-api-inventar-ladenakte.md`** | **Im Browser erhoben (11.08.2026).** Die Ladenakte: Belegarchiv (**mindestens 593.314 Dokumente** — alle 131 Betriebe gezählt, aber nur acht der vierzehn Belegarten, mit Lieferant, Kreditor, Sachkonto, MwSt-Split), **BWA-Longterm seit 2009 mit 77 Zeilen** inkl. Miete/Energie/Franchisegebühr/EBITDA, Stammdaten (Sitzplätze, Fläche, Plan-BWA, Tagesbudget), Verträge mit Fristen. Enthält zwei Warnungen: **Löschen geschieht per GET**, und der Lohn-Zweig führt Ausweisdokumente und Krankmeldungen. | Bevor du Belege, BWA-Historie oder Kapazitätsdaten anfasst |
| **`lina-api-korrekturen.md`** | **Wichtig.** Drei widerlegte Annahmen und ein gelöster Blocker. Überschreibt die beiden Dateien darüber, wo es abweicht. | Vor jeder Arbeit an Kennzahlen oder Betriebs-Reports |
| **`kennzahlen-mapping.md`** / `.csv` | Excel-Kennzahl → LINA-Endpunkt/Feld → offene Fragen. Die eigentliche Zieldefinition. | Wenn du eine Kennzahl baust oder prüfst |
| **`architektur.md`** | Warum Hetzner + Dokploy + vanilla Postgres. Verworfene Alternativen mit Begründung. | Vor Infrastrukturänderungen |
| **`datenmodell.md`** | Schema-Entscheidungen und ihre Begründung | Vor Schemaänderungen |
| **`befunde-datenlage.md`** | Was in den **echten** Daten steckt und jede Zahl anders lesbar macht: nur 62 der 141 Betriebe machen Umsatz, die zehn stärksten tragen über ein Drittel, Personalquoten bis 1132 %. Dazu: LINA liefert in den geholten Endpunkten keine Betriebsadressen. | Bevor du einen Mittelwert bildest oder eine Zahl weitergibst |
| **`metabase.md`** | Welche Schemata Metabase sehen soll, wo man anfängt, welche Fallen `mart` ausräumt, und die Regeln für neue `mart`-Sichten | Bevor du eine Auswertung baust oder eine `mart`-Sicht änderst |
| **`metabase-sichtbarkeit.md`** | Welche der 111 Tabellen Metabase zeigt (41), welche nur in Detailansichten (28) und welche gar nicht (42) — je mit Begründung und der Falle, in die ein Direktzugriff läuft | Wenn eine Tabelle in Metabase fehlt oder nach einer Migration auftaucht |
| **`dashboards.md`** | Was in Metabase steht, warum es so aussieht, und warum Dashboards aus `metabase/` erzeugt und nicht in der Oberfläche gepflegt werden | Bevor du ein Dashboard oder eine Karte anfasst |
| **`importer.md`** | Aufbau des Importers: Warteschlange, Drosselung, Session, Transformationen | Vor Arbeit an `src/` |
| **`backfill.md`** | Strategie und Rechnung für die Historie | Wenn du Zeiträume einreihst |
| **`entscheidungen.md`** | Entscheidungsprotokoll, chronologisch, inklusive der revidierten | Wenn du dich fragst „warum eigentlich so" |
| **`protokoll-anmeldeverfahren.md`** | Wie LINAs Anmeldung funktioniert, was das sicherheitstechnisch bedeutet, und was daraus folgt | Bevor du an `auth.ts` arbeitest oder jemand nach dem Passwortumgang fragt |
| **`plan-foodnotify.md`** | **Der Plan für FoodNotify**: was geholt wird, wie es mit LINA verzahnt wird, in welcher Reihenfolge | Zuerst, wenn du an FoodNotify baust |
| **`foodnotify-api-inventar.md`** | FoodNotify: 126 API-Pfade, vier Marken im Vergleich, der defekte Verkaufs-Import | Bevor du einen FoodNotify-Endpunkt anfasst |
| **`datensicherung.md`** | Welche Rohdaten wir sichern sollten, solange LINA erreichbar ist — nach Wert und Kosten sortiert | Wenn du über neue Endpunkte oder Backfill-Tiefe entscheidest |
| **`plan-datenvollstaendigkeit.md`** | **Was der Sync nicht nachhält**: das Audit vom 13.08.2026 mit jeder Messung, die Reihenfolge der Reparaturen, und was Eugene entscheiden muss | Bevor du an `nachfuellen.ts`, am Belegarchiv oder an einem Nachlauf baust |
| **`plan-datenvollstaendigkeit-nachtrag.md`** | **Ergänzt den Plan, ersetzt ihn nicht.** Das Review vom 13.08.2026 der fertigen Phase 1: drei Konstruktionsfehler der neuen Mechanik (Phase 1c) und vier Ergänzungen zu Phase 2 — darunter, dass Bestelldetails nie nachaltern | Zusammen mit dem Plan darüber, bevor du Phase 1c oder 2 anfasst |
| **`offene-punkte.md`** | Was ungeklärt ist und wer es klären muss | Bevor du etwas als fertig meldest |
| **`datenlage-round-table.html`** / `.pdf` | Was der Round-Table-Map noch fehlt — nach der Messreihe vom 11.08.2026 nur noch Rechte, Bounti/OpenTable, Stammdatenpflege und fachliche Festlegungen | Bevor du einen Punkt als „fehlt" weitergibst |
| **`payloads/`** | Echte, anonymisierte LINA-Antworten aus der Exploration | Als Referenz; identisch mit den Test-Fixtures |

### Dokumentationspflicht

**Ein Befund, der nur in einer Commit-Nachricht steht, ist verloren.** Am 26.07.2026 nachgesehen:
von den zwanzig Fehlern, die dieses Projekt gefunden hatte, stand **kein einziger** in `docs/`. Das
Wissen lag in Commit-Nachrichten und Code-Kommentaren — für den nächsten Agenten praktisch
unauffindbar, und genau die Fehler hätten sich damit wiederholt.

Deshalb gehört zu jeder Arbeit die passende Zeile in `docs/`. Nicht hinterher, sondern im selben
Commit.

| Du hast … | … dann schreibst du in |
|---|---|
| einen Fehler gefunden oder behoben | `fehlerkatalog.md` — Symptom, Ursache, was ihn künftig verhindert |
| einen Endpunkt aktiviert, ein Feld anders gedeutet, einen Schlüssel entdeckt | `datenherkunft.md`, bei API-Details zusätzlich `lina-api-inventar*.md` |
| eine Annahme widerlegt | `lina-api-korrekturen.md` — und die alte Aussage dort **durchstreichen**, nicht löschen |
| dich zwischen zwei Wegen entschieden | `entscheidungen.md`, mit Begründung. Revidierte Entscheidungen bleiben stehen, durchgestrichen |
| am Schema gearbeitet | `datenmodell.md` |
| am Importer gearbeitet | `importer.md` |
| eine `mart`-Sicht gebaut oder geändert | `metabase.md` |
| eine Dashboard-Karte gebaut oder eine Visualisierung gewählt | `dashboards.md` — und **warum diese Darstellung**, nicht nur welche |
| in den echten Daten etwas gefunden, das andere Zahlen relativiert | `befunde-datenlage.md`, mit Datum und der Abfrage, mit der du es gemessen hast |
| etwas gemessen, das andere Zahlen einordnet | dorthin, wo die Zahl gelesen wird — meist `metabase.md` oder `datenherkunft.md` |
| etwas gefunden, das jemand anderes klären muss | `offene-punkte.md` |

Vier Gewohnheiten, die diese Dateien brauchbar halten:

* **„Nachgemessen am …" statt „sollte".** Zweimal in diesem Projekt behauptete ein Kommentar das
  Gegenteil dessen, was der Code tat. Beide Male hat erst eine Messung es aufgedeckt. Schreib die
  Zahl hin und das Datum.
* **Falsches nicht löschen, durchstreichen.** Wer nicht sieht, dass eine Annahme einmal galt,
  stellt sie neu auf.
* **Die Begründung ist wichtiger als die Regel.** „Warum" überlebt eine Refaktorierung, „was"
  nicht.
* **Kommentare und `docs/` sind deutsch**, damit sie in Postico neben den Daten lesbar sind.

### `examples/` — die Quelle der Anforderung

Die heute manuell gepflegten Excel-Dateien. **`JULI_Round_Table_Ampelsystem.xlsx` ist die verbindliche Zieldefinition** — `mart.round_table()` bildet dessen Blatt „Eingabe" nach und ist gegen die Zeile „Enchilada Bayreuth" verifiziert. Dazu die Screenshots aus dem Strategiemeeting und die Projektbeschreibung.

### `migrations/` — Datenbankschema

Handgeschriebenes SQL, nummeriert, wird der Reihe nach angewendet. Bewusst handgeschrieben und kein ORM-Generat: Partitionierung, BRIN-Indizes, `UNIQUE NULLS NOT DISTINCT`, Views und PL/pgSQL-Funktionen lassen sich in einem ORM nicht ausdrücken — und genau die tragen hier die Fachlogik. Der Importer greift über `node-postgres` mit einfachem SQL zu, ohne ORM-Schicht.

| Datei | Inhalt |
|---|---|
| `0001_grundlage.sql` | Schemata, Zeitbehandlung, Partitionsverwaltung |
| `0002_stammdaten.sql` | Dimensionen und ihre monatliche Historie (`*_stand`, `*_zeitraum`) |
| `0003_bewegungsdaten.sql` | `raw.api_antwort` und die Faktentabellen |
| `0004_bewertung.sql` | `manual`, Ampel-Regelwerk, Seed |
| `0005_sync.sql` | Betriebszustand und Arbeitsschlange des Importers |
| `0006_mart.sql` | Alle Sichten und Funktionen für Metabase |
| `0029_pruefung_wareneinsatz_stilllegen.sql` | Prüfsicht gelöscht, `abdeckung_pct` repariert — sie stand immer auf 100 % |
| `0030_foodnotify.sql` | **FoodNotify**: Marke, Kostenstelle, POS-Zuordnung, Rezept, Zutat, Ware, Einkauf. Räumt LINAs WAWI-Tabellen ab |
| `0049_vergleichsgruppen.sql` | Betrieb gegen Marke und gegen Stadt. Die **einzige belastbare Stadtangabe** ist `mart.nachbarschaft.ort` aus `manual.betrieb_standort` — `core.betrieb.stadt` ist bei allen 141 NULL |
| `0069_belegarchiv_zulauf.sql` | **Der Zulauf des Belegarchivs.** `core.belegart.inhalt_holen` und `core.belegarchiv_bestand.quelle`, dazu `mart.belegarchiv_zulauf` und `mart.inventur_abgeschnitten`. Der Torwächter ist ab hier die tägliche Zählung (`la:belegzahl`) und nicht mehr `manual.belegarchiv_soll` |
| `0070_wiederbelebung.sql` | `sync.warteschlange.wiederbelebt` und `mart.posten_aufgegeben`. Der Lauf holt aufgegebene Posten hoechstens dreimal selbst zurueck und zieht unvollstaendige Inventurzaehlungen selbst nach — **kein Handbefehl** |
| `0071_pruefsichten_hygiene.sql` | Die Pruefsichten sagen wieder, was sie meinen: die 36-h-Zeile klammert Betriebe ohne Belegarchiv aus und fuehrt sie als eigene Zeile (Erwartung **konstant**, nicht null), `mart.belegarchiv_zulauf` bekommt `zaehlung_status`. Eine Kachel, die nie auf null geht, liest niemand mehr |
| `0072_bestelldetails_altern.sql` | **Bestelldetails altern nach.** `core.bestellung.detail_geholt_am` und `mart.bestelldetail_stand`. Bis dahin wurde jede der 66.966 Bestellungen **genau einmal** im Detail geholt und keine je erneut — Liefermengen und Preisstaende standen auf dem Stand des ersten Abrufs. Der Nachholauf ist kein Befehl, sondern eine Obergrenze im Nachtlauf |
| `0073_namensvergleich_apostroph.sql` | `core.name_norm()` **loescht** Apostrophe, statt sie in Leerzeichen zu wandeln (59 exakte Namenstreffer vorher, 60 nachher, 0 verloren). Dazu `mart.kostenstelle_ohne_betrieb` als Entscheidungsliste — die offenen Faelle werden **sichtbar gemacht, nicht geraten** |
| `pruefung.sql` | Verifikation gegen den Bayreuth-Fall aus dem Excel (kein Migrationsschritt) |

Die Tabelle nennt die tragenden Migrationen, nicht jede einzelne. Der verbindliche Stand steht in `public.schema_migration`.

Migration hinzufügen: neue Datei `NNNN_name.sql`, aufsteigend. **Bereits angewendete Dateien nie ändern** — der Stand steht in `public.schema_migration`.

**Vor dem Anlegen `ls migrations/` — die Nummer muss frei sein.** Der Runner merkt sich Dateinamen, nicht Nummern: zwei Dateien mit derselben Nummer laufen beide, in alphabetischer Reihenfolge ihrer Namen. Das ist deterministisch, aber niemand sieht es der Nummer an. Am 26.07.2026 ist es passiert, als zwei Agenten parallel arbeiteten (`0009_kennzahlen_namen` und `0009_zugangssperre`) — nachträglich umbenennen hätte bedeutet, `public.schema_migration` in einer laufenden Datenbank von Hand zu korrigieren, also blieb es stehen.

Am 26.07.2026 sind die vorherigen zehn Dateien zu diesen sechs zusammengefasst worden, weil sich der Stand nur noch durch Nachspielen der Historie lesen ließ: `0005` korrigierte eine Aussage aus `0000`, `0007` einen Entwurfsfehler aus `0000`, `0009` einen aus `0003`. Die Begründungen sind dabei erhalten geblieben — sie stehen jetzt an der Stelle, die sie erklären.

### `metabase/` — Dashboards als Code

Die Dashboards werden nicht in der Oberfläche gepflegt, sondern hier definiert und per
`uebernehmen.ts` übertragen. Wer in Metabase klickt, verliert die Änderung beim nächsten
Durchlauf. Aufbau, Begründung und die Regeln für Diagrammtypen: `docs/dashboards.md`.

```
uebernehmen.ts     Karten und Dashboards anlegen — der vollständige Lauf
sichtbarkeit.ts    welche Tabellen Metabase zeigt (docs/metabase-sichtbarkeit.md)
auswahllisten.ts   Filterlisten von Hand abgleichen — läuft sonst als Nachlauf im Sync
karten-import.ts   die technische Seite: läuft der Import, woran hängt es
karten-vergleich.ts  Betrieb gegen Marke, Betrieb gegen Stadt — die kurze
                     Fassung auf ③ Betrieb, die lange auf ⑨ und ⑩
```

⚠️ **`uebernehmen.ts` ist kein Trockenlauf.** Mit `METABASE_USER`/`METABASE_PASSWORD` in der
Umgebung — so steht es in `.env` — meldet sich das Skript selbst an und schreibt **sofort**
gegen `METABASE_URL`, die Produktivinstanz. Kein Browser, keine Rückfrage. Ohne die beiden
Variablen fällt es auf den älteren Weg zurück (Server auf `:8899`, im Browser „Übernehmen"
klicken). Wer nur die Definitionen prüfen will: `bun test metabase/karten.test.ts` — der
fasst Metabase nicht an. Hergang in `docs/fehlerkatalog.md` (10.08.2026).

**Beschreibungen richten sich an Fachbereichs-Mitarbeitende, nicht an Techniker.** Keine
Tabellennamen, keine Excel-Zellbezüge, keine Begründung von Bauentscheidungen — die gehören
als Kommentar in die `karten-*.ts`. Was vor einem Fehlschluss schützt, bleibt. Ebenso wenig
gehören feste Messwerte hinein („am 26.07.2026 waren es 79 von 141"): sie veralten still.
Regel und Beispiele in `docs/dashboards.md`.

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
health.ts              /health und /status, hält den Container oben
status.ts              Statusbericht fürs Monitoring — acht Prüfungen
sync.ts / einreihen.ts Einstiegspunkte
```

---

## Befehle

```bash
bun install
bun run migrate                              # Schema anwenden (idempotent)
bun test                                     # nachgemessen am 13.08.2026 (abends): 683 pass, 157 skip, 0 fail ohne TEST_DATABASE_URL
bun run sync                                 # nachfüllen UND abarbeiten
bun run einreihen --taeglich                 # nur nachfüllen (sync macht das selbst)
bun run einreihen --historie --von 2018-01-01 --bis 2026-07-24
bun run einreihen --foodnotify               # FoodNotify-Backfill starten
bun run einreihen --foodnotify-inventuren    # Inventur-Backfill starten (B1, lohnend fast nur bei Wilma Wunder)
bun run health                               # Health-Endpunkt (Container-CMD)
curl localhost:3000/health                     # lebt der Container?
curl localhost:3000/status                     # muss jemand hinsehen? (503 = ja)
bun run typecheck
bun run lina-fragen                          # LESENDE Einzelmessungen gegen LINA, d1-d6
                                             # (nur im Terminal des Nutzers, Regel 7a)
bun run belege-vorschau                      # rechnet nur: welche Belegdateien ein Abzug zöge
bun run belege-herunterladen                 # zieht die PDFs und die eingebetteten E-Rechnungs-XML
                                             # nach ./belege (nur lokal, Regel 7a — der Server
                                             # startet das nicht und soll es nicht)
```

Für den Ende-zu-Ende-Test zusätzlich `TEST_DATABASE_URL` setzen — ohne die Variable wird er übersprungen.

---

## Betrieb

**Dokploy auf einem Hetzner-Server.** Postgres als *Managed Database* (die geplanten S3-Backups sind eingebaut, Ziel ist Bunny Storage — anderer Anbieter, andere Ausfalldomäne). Der Importer als *Application* aus dem GitHub-Repo mit Build-Typ **Dockerfile**, nicht Nixpacks.

Dokploys Schedule Jobs führen Kommandos per `docker exec` in einem **laufenden** Container aus; sie starten keinen neuen. Deshalb hält `health.ts` den Container oben, und der Job ruft `bun run sync` als eigenen Prozess auf. Jeder Lauf startet damit frisch, und man bekommt pro Lauf einen Log-Eintrag samt manueller Auslösung.

**Ein** Schedule Job:

```
täglich 05:02   bun run sync
```

> **Nachgemessen am 10.08.2026**, weil hier „stündlich" stand: `mart.sync_status` führt die
> Läufe 76 bis 80 an fünf aufeinanderfolgenden Tagen, jeweils um 05:02, `lauf_id` lückenlos.
> Bei stündlichem Lauf wären es rund 24 IDs je Tag. Wer das Intervall ändert, ändert damit
> auch die Yext-Fälligkeit (20 Stunden) — bei einem Lauf pro Tag greift sie faktisch immer.

`sync` füllt die Warteschlange zu Beginn jedes Laufs selbst (`src/sync/nachfuellen.ts`):
LINAs Nachzügler-Fenster, Jahresberichte, monatliche Momentaufnahmen und FoodNotifys
jeweils letzte Bestellseite je Kostenstelle.

Bis zum 02.08.2026 war das Nachfüllen ein zweiter Job. Fiel er aus, lief `sync`
munter weiter, meldete „ok" und tat nichts — LINA stand acht Tage still, während
der Importer fehlerfrei durchlief. **Ein Importer ohne Arbeit sieht genauso aus wie
einer, der fertig ist.** Ein Zeitplan, ein Ausfallpunkt.

Die beiden **Backfills** (`--historie`, `--foodnotify`) bleiben ausdrücklich
Handarbeit: sie stellen Zehntausende Posten ein, und das soll eine Entscheidung
sein, kein Nebeneffekt eines Neustarts.

Der Sync läuft **tagsüber** (Fenster 7–23 Uhr, konfigurierbar). Das ist Absicht: ein einzelner Client um drei Uhr früh ist im Log ein Ausreißer, dieselben Anfragen im Tagesverkehr von 141 Betrieben fallen nicht auf.

**Postgres nie ins Internet exponieren** — Postico über SSH-Tunnel.

---

## Wo man nachschaut, wenn etwas klemmt

Alles in Postico, keine Log-Wühlerei nötig:

```sql
SELECT * FROM mart.sync_status LIMIT 5;              -- letzte Läufe
SELECT * FROM mart.backfill_fortschritt;             -- Fortschritt je Endpunkt
SELECT * FROM mart.betrieb_ohne_lina_id;             -- Betriebe ohne Brücke zur BWA (Erwartung: leer)
SELECT * FROM mart.zugangssperre;                    -- ruht der Zugang? (Erwartung: leer)
SELECT * FROM sync.aufgabe ORDER BY aufgabe_id DESC LIMIT 50;
SELECT * FROM sync.schema_abweichung WHERE quittiert_am IS NULL;
SELECT * FROM sync.warteschlange WHERE letzter_fehler IS NOT NULL;
```

Bekommt jede Quelle noch Zulauf? (Regel 10 — seit 13.08.2026)

```sql
-- Belegarchiv: eine Zeile je Betrieb und Ordner, 1.834 insgesamt
SELECT zustand, count(*) FROM mart.belegarchiv_zulauf GROUP BY 1 ORDER BY 2 DESC;
SELECT * FROM mart.belegarchiv_zulauf WHERE zustand = 'abzug fehlt';
-- Inventuren, deren Kopf mehr Positionen meldet als geladen sind (Erwartung: leer)
SELECT * FROM mart.inventur_abgeschnitten;
-- Posten, die der Worker aufgegeben hat. 'endgueltig' heisst: der Lauf versucht
-- es nicht mehr, und das will jemand gelesen haben.
SELECT zustand, count(*) FROM mart.posten_aufgegeben GROUP BY 1;
```

**Nichts davon braucht einen Befehl.** Abgeschnittene Inventurzählungen und aufgegebene
Posten repariert der nächtliche Lauf selbst (`inventurpositionenNachziehen()` und
`aufgegebeneWiederbeleben()` in `src/sync/nachfuellen.ts`). Handarbeit bleiben nur die beiden
Historien-Backfills — `--historie` und `--foodnotify` —, weil sie eine Entscheidung sind und
kein Befund.

Nach jedem größeren Backfill zuerst:

```sql
SELECT * FROM mart.pruefung_uebersicht;   -- rechnet LINAs Aggregate gegen unsere Artikeldaten nach
```

Seit dem 13.08.2026 stehen dort vier Zulaufprüfungen mit drin. **`auffaellig = 0` heißt nicht
„nichts zu tun", sondern „nichts Auffälliges gemessen"** — die Zeile „Belegarchiv: seit über
36 h nicht gezählt" ist die, die den Unterschied macht.

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

Vergleichsgruppen — schwächelt der Betrieb oder alle:

```sql
-- gegen die eigene Marke (Median der operativen Betriebe, mit Rang)
SELECT * FROM mart.marke_vergleich WHERE betrieb = 'Enchilada Karlsruhe GmbH';
-- gegen die Nachbarbetriebe am selben Ort
SELECT * FROM mart.stadt_vergleich WHERE ort = 'Karlsruhe' AND bereich = 'umsatz';
-- Städte mit mehr als einem laufenden Betrieb
SELECT * FROM mart.stadt_schnitt_monat WHERE monat = DATE '2026-06-01';
-- Arbeitsliste: wem fehlt die Ortsangabe? (Erwartung: kein operativer dabei)
SELECT * FROM mart.nachbarschaft_fehlend WHERE status = 'operativ';
```

**Die Stadt steht NICHT in `core.betrieb.stadt`** — die Spalte ist bei allen 141 Betrieben
NULL und wird trotzdem durch ein Dutzend `mart`-Sichten durchgereicht. Wer danach gruppiert,
bekommt eine Gruppe mit allen Betrieben darin, ohne Fehlermeldung. Die gepflegte Stadt kommt
aus `manual.betrieb_standort` und ist über `mart.nachbarschaft` zu lesen.

**Der Betriebsname ist NICHT eindeutig.** In `getKennzahlen` liefert die Gruppe die Marke, das Kind nur die Stadt — fünf Betriebe heißen „Karlsruhe". Immer über `enc_id` joinen, nie über den Namen. Ob dahinter fünf Betriebe stehen (erwartet) oder ein Betrieb in fünf Marken, klärt: `SELECT anzahl_konzepte, count(*) FROM mart.konzept_zuordnung GROUP BY 1;` — Details am Kommentar von `core.betrieb_konzept` in `migrations/0002_stammdaten.sql`.

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
