# Plan: die Daten selbst befragen — Metabase MCP zuerst, Skybridge für die Leitplanken

Stand 13.09.2026. Zweite Fassung; die erste vom 12.09. ist überarbeitet, ihre Fehler stehen
in Abschnitt 0 und bleiben in `entscheidungen.md` durchgestrichen erhalten.

**Der Anlass:** Daniel und die OMs sollen jede Frage an die Daten selbst stellen können —
jede Gruppierung, jede Beziehung, nicht nur die 285 Fragen, die schon jemand als
Metabase-Karte gebaut hat — und zwar mit dem Werkzeug, das sie ohnehin benutzen: ChatGPT,
Copilot oder Claude.

---

## 0. Was die zweite Fassung anders sieht

Vier Befunde aus der vertieften Recherche, jeder ändert den Plan:

1. **Metabase hat seit Version 60 (April 2026) einen eingebauten MCP-Server.** Frei,
   OAuth eingebaut, Streamable HTTP, Rechte je Nutzer wie in Metabase, Claude/ChatGPT/VS
   Code als Clients. Unsere Instanz läuft auf v0.63 — **er ist schon da**, nur nicht
   eingeschaltet. Die erste Fassung hat ihn übersehen und einen Server entworfen, der
   zur Hälfte das nachbaut, was Metabase schon kann.
2. **285 Werkzeuge waren ein Fehler.** Cursor kappt bei 40 Werkzeugen, Copilot bei 128,
   Claude Desktop um 100 — und die Qualität sinkt messbar ab etwa 50, weil jede
   Werkzeugbeschreibung 300–600 Token kostet, bevor die erste Frage gestellt ist. Die
   Karten sind wertvoll, aber als **Beispiele**, nicht als Werkzeuge.
3. **Freies SQL ist der Hauptweg, nicht der Notausgang.** „Jede Gruppierung, jede
   Beziehung" heißt: das Modell schreibt die Abfrage. Die erste Fassung hat das als
   „Ring 3" nach hinten gestellt und gehofft, die meisten Fragen enden davor. Sie enden
   nicht davor. Die Sicherheit muss also *in* den freien Weg, nicht daneben.
4. **Es fehlte die Beziehungsschicht.** `mart` besteht aus Sichten, und Postgres kennt
   keine Fremdschlüssel auf Sichten (`metabase/beziehungen.ts` hat genau dieses Problem
   für Metabase gelöst). Ein Modell, das `mart.umsatz_tag` mit `mart.personalkosten`
   verbinden will, muss wissen, dass beide über `betrieb_key` und den Tag zusammenfinden —
   und dass `betrieb` als Name **nicht** eindeutig ist. Ohne diese Schicht gibt es keine
   „beliebige Beziehung", nur beliebige Joins.

Was bleibt: **nur `mart`, `manual`, `ampel`**; erzwungen über eine Datenbankrolle; jede
Antwort trägt ihre Fallstricke; kein Schreibzugriff; jede Abfrage protokolliert.

---

## 1. Was die Forschung dazu sagt

Zwei Zahlen tragen den ganzen Plan.

**Semantische Schicht gegen rohes Text-to-SQL** — dbt-Benchmark, April 2026, mit Claude
Sonnet 4.6 und GPT-5.3-Codex: auf einem *modellierten* Projekt steigt die Trefferquote von
**90,0 % auf 98,2 %** (Sonnet) bzw. **84,1 % auf 100 %** (GPT) — und wichtiger als die
Prozentpunkte ist die **Art des Scheiterns**: ohne semantische Schicht ist ein Fehler eine
selbstbewusst falsche Zahl, mit ihr ist er eine Verweigerung („kann ich so nicht
beantworten"). **81,2 % der Text-to-SQL-Fehler entstehen auf Schema- und Bedeutungsebene**,
nicht in der Syntax. Das ist wörtlich die Erfahrung dieses Projekts aus `fehlerkatalog.md`.

Eine semantische Schicht ist dabei nichts Magisches. Sie ist: **Körnung** (eine Zeile je
was?), **Achsen** (worüber wird gruppiert und verbunden?), **Kennzahlen** (was darf man
summieren, was nur als Median lesen?) und **Regeln** (was darf man nicht?). Genau das steht
in diesem Repository bereits — verteilt auf Tabellenkommentare, `docs/` und die Karten.

**Was aus dem SQL-Text der Migrationen gemessen wurde** (13.09.2026, jeweils letzte
Definition einer Sicht):

| | Anzahl |
|---|---|
| `mart`-Sichten | **191** (188 mit Kommentar, 3 ohne) |
| davon mit `betrieb_key` | 132 |
| mit `monat` | 85 |
| mit `konzept` | 82 |
| mit `geschaeftstag` | 42 |
| mit `kostenstelle` (FoodNotify-Achse) | 21 |
| mit `lieferant` | 15 · `ort` 12 · `bundesland` 9 · `ware` 10 · `warengruppe` 6 |
| Kommentare, die ihre **Körnung** ausschreiben („eine Zeile je …") | **23 von 188** |
| Kommentare mit einem Warnwort (nicht, nie, nur mit, immer auf, darf) | **114 von 188** |

Die Warnungen sind da. **Die Körnung fehlt in 165 Kommentaren** — und die Körnung ist das
Erste, was ein Modell braucht, bevor es summiert. Das ist die konkreteste Lücke, die dieser
Plan schließt (Abschnitt 5).

---

## 2. Stufe 0 — Metabase MCP einschalten (diese Woche)

Der eingebaute Server (`/api/metabase-mcp`, Admin → AI → MCP) bringt fertig mit, was die
erste Fassung bauen wollte:

| Was er kann | Warum das hier schon passt |
|---|---|
| Suchen über Tabellen, Modelle, Kennzahlen, Fragen, Dashboards | Metabase sieht nur `mart`, `manual`, `ampel` (`metabase-sichtbarkeit.md`) — **die Schemabegrenzung gilt automatisch** |
| Tabellen- und Spaltenbeschreibungen | Sind die Kommentare aus den Migrationen — Metabase liest sie aus dem Katalog |
| Abfragen bauen (MBQL) mit Joins entlang bekannter Beziehungen | `beziehungen.ts` hat `betrieb_key` und `aktion_key` als FK verdrahtet; das Modell bekommt Betriebsnamen statt Schlüsselzahlen |
| SQL ausführen — **je Gruppe abschaltbar** (native-query-Recht) | Daniel: nur MBQL. Eugene: SQL. Ohne eine Zeile Code |
| Ergebnis als Balken, Linie, Tabelle im Chat | Für Verläufe ausreichend |
| OAuth aus Metabase selbst, Rechte je Nutzer | Kein Identitätsanbieter nötig — die Nutzer sind schon in Metabase |
| Bestehende Fragen und Dashboards lesen | Die 285 Karten sind als **Beispiele** sofort da |
| Seitenweise 200 Zeilen, höchstens 2.000 | Die Zeilengrenze, die wir bauen wollten |

**Was er nicht kann — und was daraus die Stufe 1 macht:**

| Lücke | Folge |
|---|---|
| Kein Befund-Anhang: das Ergebnis trägt seine Fallstricke nicht bei sich; der Kommentar ist da, aber nur, wenn das Modell ihn gelesen hat | Die Kernidee der ersten Fassung bleibt offen |
| Kein Datenstand am Ergebnis | „Juli-Zahlen" ohne die Information, dass die BWA bei Mai steht |
| Keine Prüfung der Abfrage vor dem Lauf (Gruppierung über eine Spalte, die überall NULL ist; `fremdeinkauf` ohne `quelle`) | Die stillen Fallen bleiben still |
| Keine Ampelansicht — nur Balken, Linie, Tabelle | Der Round Table als Text |
| Kein eigenes Protokoll je Frage, nur Metabases Abfrageprotokoll | Reicht für „wer hat was gefragt", nicht für „welche Frage kam zehnmal" |

**Ablauf Stufe 0:**

1. Admin → AI-Funktionen an, MCP an. Kein API-Schlüssel nötig — der ist nur für Metabot.
2. Öffentlicher Hostname mit TLS für Metabase (Claude Desktop verbindet nicht mit
   `localhost`; ChatGPT, Claude und VS Code müssen in Metabases CORS-Liste).
3. Gruppe *Fachbereich* ohne native-query-Recht, Gruppe *Analyse* mit.
4. Daniel bekommt den Connector und **die zehn Fallenfragen aus Abschnitt 6.3** — dieselben,
   gegen die später Stufe 1 gemessen wird.
5. **Zwei Wochen messen**, nicht meinen: Metabases Abfrageprotokoll auswerten. Welche
   Fragen kamen, welche endeten in einer falschen Zahl, welche in einer Verweigerung.

**Die Entscheidung am Ende von Stufe 0:** Wenn die Fallenfragen mit Beschreibungen und
FK-Verdrahtung schon sauber laufen, ist Stufe 1 ein Ausbau (Ampeln, Protokoll), keine
Rettung. Wenn nicht, wissen wir aus dem Protokoll *welche* Fallen — und bauen genau dafür.

**Zu prüfen, bevor jemand darauf baut** (in `offene-punkte.md`): dass der MCP-Server in der
Open-Source-Ausgabe enthalten ist — die Dokumentation nennt keine Einschränkung, die
Release-Seite spricht von „frei und Open Source", aber gemessen ist es an unserer Instanz
noch nicht.

---

## 3. Stufe 1 — der eigene Server (Skybridge)

Für das, was Metabase MCP nicht tut: die Prüfung **vor** dem Lauf, der Befund-Anhang **am**
Ergebnis, die Ampel als Ansicht, das eigene Protokoll. Alles andere — Suche, Katalog,
Beispiele — kann er auch, aber das ist nicht sein Grund.

```
Daniel (Claude / ChatGPT / VS Code Copilot)
   │  MCP über HTTPS, OAuth
   ▼
mcp.<domain>            ← Skybridge-App, eigene Dokploy-Application
   │  Katalog · Prüfung · Ausführung · Befund-Anhang · Ansichten · Protokoll
   ▼
PostgreSQL 18           ← Rolle `mcp_leser`: mart/manual/ampel, nur lesend
```

**Warum Skybridge** (MIT, TypeScript, Zod — der Stack dieses Repositories): ein
Werkzeug + eine React-Ansicht, ein Codestand für Claude, ChatGPT und VS Code; ein Tunnel,
um gegen echtes Claude und ChatGPT zu testen, bevor etwas auf dem Server steht; OAuth über
WorkOS/Auth0/Clerk/Descope/Stytch oder einen beliebigen IdP mit Discovery-Dokument
(`customProvider({ issuer, audience })`) — die Identität kommt im Handler als
`extra.http.authInfo` an. Drei Antwortkanäle je Werkzeug, die wir gezielt nutzen:
`structuredContent` (liest das Modell), `content` (Zusammenfassung), `_meta` (nur die
Ansicht — hier wandert die volle Tabelle hin, das Modell bekommt nur die gekürzte).

**Warum selbst gehostet, nicht auf Alpic:** die Datenbank ist von außen nicht erreichbar
und soll es nicht werden. Ein eigener Container neben Postgres und Metabase, kein Endpunkt
in `src/health.ts` — der Importer ist ein nächtlicher Batch, ein Dienst mit
Publikumsverkehr hat ein anderes Risikoprofil. Alpics Tunnel bleibt für die Entwicklung.

---

## 4. Die Werkzeuge — acht, nicht 285

Verb-basierte Namen, wie Skybridge sie empfiehlt; deutsch, weil das ganze Vokabular der
Datenbank deutsch ist und das Modell sonst übersetzt und dabei danebengreift.

| Werkzeug | Tut | Kanal |
|---|---|---|
| `sichten_suchen(stichwort)` | Sichten samt Kommentar, Körnung, Achsen | Text |
| `sicht_beschreiben(name)` | Spalten mit Kommentar, Körnung, Achsen, Kennzahlen mit Aggregationsregel, **Fallstricke**, **Beispielabfragen aus den Karten**, drei Beispielzeilen | Text |
| `achsen_zeigen(sicht_a, sicht_b?)` | Worüber zwei Sichten zusammenfinden — oder alle Achsen einer Sicht | Text |
| `betriebe_suchen(text)` | Löst „Enchilada Karls" nach `betrieb_key` auf, mit Konzept, Status, Datenstand. Fünf Betriebe heißen „Karlsruhe" | Text |
| `abfrage_pruefen(sql)` | Parsen, Sichten erkennen, Regeln anwenden, `EXPLAIN` — **ohne zu laufen**. Liefert Hinweise und geschätzte Zeilen | Text |
| `abfrage_ausfuehren(sql)` | Prüfen, dann laufen. Ergebnis + `hinweise[]` + Datenstand der berührten Betriebe | Text + Tabelle |
| `datenstand(betrieb?)` | Was überhaupt beurteilbar ist | Text |
| `round_table(monat, konzept?, regelwerk?)` | Das Ampelraster — die eine Ansicht, die Text nicht kann | **Ansicht** |

**Die Karten werden zu Beispielen.** `sicht_beschreiben('mart.personalkosten')` liefert
neben Spalten und Fallstricken die Abfragen der Karten, die diese Sicht benutzen — samt
der Zeile `pek_gesamt > 0 AND pek_gesamt <= 200` und dem Median, die
`karten-drilldown.ts` als Bedingung dafür nennt, dass eine Personalquote überhaupt zu
gebrauchen ist. Eine Beispielabfrage der Betreuer ist für ein Modell mehr wert als eine
Beschreibung: sie zeigt, *wie* man die Sicht richtig fragt. 285 Karten werden so zu
Wissen, das nur dann Kontext kostet, wenn es gebraucht wird.

**`abfrage_pruefen` ist als eigenes Werkzeug da, damit das Modell es vor einer großen
Frage aufrufen kann** — und `abfrage_ausfuehren` ruft es ohnehin intern auf. Zwei Wege
zum selben Schutz, keiner davon optional.

---

## 5. Der semantische Katalog — Schema `mcp`

Schichtname, deshalb englisch wie `raw`, `sync`, `mart`. Fünf Tabellen, **alle als
Daten**, keine als Code — dieselbe Begründung wie bei den Ampelregelwerken
(`datenmodell.md`, Entscheidung 5): eine neue Regel ist eine Migration, kein Deploy, und
sie steht neben den Daten, auf die sie sich bezieht.

| Tabelle | Eine Zeile je | Trägt |
|---|---|---|
| `mcp.sicht` | Sicht | **Körnung** („eine Zeile je Betrieb und Monat"), Themengebiet, ob summierbar, Verweis auf `docs/` |
| `mcp.achse` | Achse | `betrieb_key → mart.betrieb.betrieb`, `konzept`, `monat`, `geschaeftstag`, `kostenstelle → marke`, `bundesland` (über `betrieb_bundesland`), `ort` (über `nachbarschaft` — **die einzige belastbare Stadtangabe**), `lieferant`, `ware`, `aktion_key` |
| `mcp.sicht_achse` | Sicht × Achse | Welche Achsen eine Sicht trägt — daraus folgt, was womit joinbar ist |
| `mcp.kennzahl` | Sicht × Spalte | Aggregationsregel: `summe`, `median`, `letzter_stand`, `nicht_aggregieren`; Einheit (`prozentzahl`, `euro`) |
| `mcp.fallstrick` | Regel | Bedingung auf der **geparsten** Abfrage (siehe 5.2), Hinweistext, Schwere (`warnung` / `sperre`) |

**Erstbefüllung, halb automatisch:** `mcp.sicht_achse` aus den Spaltennamen (die
Konvention „Schlüssel heißt in Quelle und Ziel gleich" gilt im ganzen Schema —
`beziehungen.ts` nutzt sie schon). `mcp.fallstrick` aus den 114 Kommentaren mit Warnwort
und `fehlerkatalog.md`. **Die Körnung von Hand** — 165 Sichten, zwei Tage, und der Ertrag
geht nicht nur an den MCP-Server: dieselbe Zeile gehört in den Tabellenkommentar, dann
hat Metabase sie auch. Regel für neue Sichten in `metabase.md`: *ohne Körnung im
Kommentar keine Sicht.*

### 5.1 Körnung ist die halbe Sicherheit

Der häufigste stille Fehler ist eine Summe über die falsche Körnung: `mart.umsatz_tag`
darf man summieren, `mart.umsatz_tag_sparte` nur je Sparte, `mart.round_table_monat`
gar nicht (Prozentwerte, Mediane). Steht die Körnung im Katalog, kann `abfrage_pruefen`
eine `sum()` über eine Sicht mit `summierbar = false` **ablehnen**, nicht nur anmerken.

### 5.2 Fallstricke als Regeln auf dem Syntaxbaum

Die erste Fassung wollte Hinweise „anhand der Sichten, die in der Abfrage vorkommen"
anhängen — ein Textabgleich. Das reicht nicht für „`GROUP BY stadt`" oder „`fremdeinkauf`
ohne Filter auf `quelle`". Dafür braucht es die Abfrage als Baum.

**`libpg-query` / `pgsql-parser` ist der echte Postgres-Parser als Bibliothek** (npm,
Stand 13.09.2026: 17.7 / 18.2). Damit ist eine Regel ein Prädikat auf dem Baum:

| Regel (Beispiele) | Schwere |
|---|---|
| Gruppierung oder Filter auf `stadt` in einer Sicht, die sie aus `core.betrieb` zieht | `sperre` — die Spalte ist bei allen 141 Betrieben NULL |
| `mart.fremdeinkauf` ohne Gleichheitsfilter auf `quelle` | `sperre` — Doppelzählung |
| `mart.einkaufspreis_betrieb` ohne `vergleichbar = true` | `sperre` |
| `sum()` über eine Spalte mit Regel `median` oder `nicht_aggregieren` | `sperre` |
| Join zweier Sichten über eine Spalte, die keine gemeinsame Achse ist | `warnung` |
| Join über `betrieb` (Name) statt `betrieb_key` | `sperre` — fünf Betriebe heißen „Karlsruhe" |
| `mart.personalkosten` ohne `pek_gesamt`-Plausibilitätsfilter | `warnung` mit dem Filter aus der Karte |
| Betriebe ohne laufendes Geschäft im Nenner (`betrieb_status`) | `warnung` mit der Zahl (79 von 141) |
| Prozentwert mit `* 100` oder `/ 100` | `warnung` — Prozentwerte sind schon Prozentzahlen |
| `EXPLAIN` schätzt > 5 Mio. gelesene Zeilen | `sperre` mit Vorschlag, den Zeitraum einzugrenzen |

Eine `sperre` läuft nicht. Sie kommt mit dem Grund und, wo möglich, mit dem korrigierten
SQL zurück — das Modell bessert nach, der Mensch sieht beides im Protokoll. Das ist die
Verweigerung aus dem dbt-Benchmark, in dieses Repository übersetzt: **eine falsche Zahl,
die nicht entsteht, ist die einzige, die niemand weitergibt.**

### 5.3 Was mit jeder Antwort mitreist

```
{ zeilen: [...],            // höchstens 500, Rest in _meta für die Ansicht
  koernung: "eine Zeile je Betrieb und Monat",
  hinweise: [ "...", "..." ],
  datenstand: { umsatz_bis: "2026-09-10", bwa_bis: "2026-07", betriebe_unvollstaendig: 3 },
  protokoll_id: 4711 }
```

---

## 6. Leitplanken, die nicht im Prompt stehen

### 6.1 Die Rolle

```sql
CREATE ROLE mcp_leser LOGIN PASSWORD :'pw';
ALTER ROLE mcp_leser SET default_transaction_read_only = on;
ALTER ROLE mcp_leser SET statement_timeout = '20s';
ALTER ROLE mcp_leser SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE mcp_leser SET search_path = mart, manual, ampel;
REVOKE ALL ON SCHEMA public, raw, part, core, sync FROM mcp_leser;
GRANT USAGE ON SCHEMA mart, manual, ampel, mcp TO mcp_leser;
GRANT SELECT ON ALL TABLES IN SCHEMA mart, manual, ampel, mcp TO mcp_leser;
ALTER DEFAULT PRIVILEGES IN SCHEMA mart GRANT SELECT ON TABLES TO mcp_leser;
GRANT INSERT ON mcp.zugriff TO mcp_leser;   -- das Einzige, was geschrieben wird
```

Ein SQL-Filter im Code, der `core` verbieten soll, ist eine Liste von Umgehungen (CTE,
Funktion, `search_path`, Kommentar). Postgres hat die Prüfung eingebaut und vollständig.
Der Parser aus 5.2 kommt **dazu** — für die Fallstricke, nicht für die Rechte.

Der Importer behält seine Rolle; `MCP_DATABASE_URL` ist eine eigene Variable (Regel 2).

### 6.2 Grenzen

| | Wert | Warum |
|---|---|---|
| Zeilen an das Modell | 500 | `mart.umsatz_tag` hat 443.304 Zeilen; mehr sprengt den Kontext, bevor es etwas beantwortet |
| Zeilen an die Ansicht (`_meta`) | 5.000 | Eine Tabelle darf blättern, ein Modell nicht |
| Laufzeit | 20 s | Ein Modell wartet nicht, es probiert etwas anderes |
| Geschätzte Zeilen (`EXPLAIN`) | 5 Mio. | Vor dem Lauf, nicht nach dem Timeout |
| Gleichzeitig je Nutzer | 2 | Der Server teilt sich die Maschine mit dem Importer |

### 6.3 Die zehn Fallenfragen

Sie sind die Regressionssicherung des ganzen Vorhabens, werden in Stufe 0 gegen Metabase
MCP gestellt und in Stufe 1 als Testdatei festgehalten. Jede muss entweder richtig
beantwortet werden oder eine Sperre/Warnung tragen:

1. Umsatz je Stadt, letzter Monat *(stadt ist NULL)*
2. Durchschnittliche Personalquote aller Betriebe *(79 ohne Geschäft; Median statt Mittel; Tagesnenner)*
3. Fremdeinkauf je Betrieb, Summe über das Jahr *(quelle)*
4. Welcher Betrieb zahlt am meisten für Mozzarella *(vergleichbar; Gebinde)*
5. Personalquote von „Karlsruhe" *(fünf Betriebe)*
6. Umsatz und Personalkosten Juli nebeneinander *(BWA-Versatz je Betrieb)*
7. Wareneinsatz aus Rezepturen *(pos_artikel leer)*
8. Umsatz nach Bundesland *(60 von 141 Standorte gepflegt)*
9. Wareneinsatzquote als Bruch × 100 *(Prozentzahl)*
10. Umsatz gegen Vorjahr, kumuliert *(umsatz_ytd statt Handrechnung)*

### 6.4 Protokoll

`mcp.zugriff(id, zeitpunkt, nutzer, client, werkzeug, parameter jsonb, sql, hinweise
jsonb, gesperrt bool, zeilen, dauer_ms, fehler)`. Eine Zahl, die im Round Table landet,
muss rekonstruierbar sein — die Chat-Antwort ist kein Beleg, die Zeile hier ist einer.
Und: ein Dienst ohne Zulauf ist ein Fehler (Regel 10) — `mart.mcp_nutzung`, eine
Prüfzeile in `/status`. Wiederholte Fragen und häufige Sperren sind die Anforderungsliste
für die nächsten `mart`-Sichten.

---

## 7. Anmeldung

Stufe 0: Metabases eigener OAuth-Server, Nutzer und Gruppen wie gehabt. **Nichts zu
entscheiden.**

Stufe 1: ein Anbieter mit Discovery-Dokument. Gibt es bei Concept Family Microsoft 365 /
Entra, ist das der richtige (`customProvider({ issuer, audience })`): Ausscheiden aus dem
Unternehmen heißt dann Zugangsverlust. Sonst WorkOS oder Clerk mit Allowlist. Rechte in
zwei Stufen — `lesen` (Katalog, fertige Werkzeuge) und `fragen` (freies SQL) — und **kein
Schreiben**: `manual` ist das einzige Schema, das von Hand entsteht und das ein Backfill
nicht wiederherstellen kann.

---

## 8. Was in welchem Client ankommt

| | Claude | ChatGPT | Copilot (VS Code) |
|---|---|---|---|
| Metabase MCP (Stufe 0) | ja | ja, Developer Mode oder Admin-Freigabe | ja |
| Charts aus Metabase MCP | Balken/Linie/Tabelle | dito, nach CORS-Freigabe | dito |
| Skybridge-Ansichten (Stufe 1) | ja | ja | eingeschränkt — Daten statt Ansicht |
| Werkzeugobergrenze | ~100 | — | 128 |

Folge: jedes Werkzeug muss ohne seine Ansicht brauchbar sein; die Ansicht ist die Kür.

---

## 9. Phasen

| Phase | Inhalt | Fertig, wenn |
|---|---|---|
| **0 — Metabase MCP** (diese Woche, ½ Tag) | Einschalten, Hostname/TLS, CORS, Gruppen, Daniel freischalten, zehn Fallenfragen | Daniel hat in ChatGPT eine Frage beantwortet bekommen, die auf keiner Karte steht |
| **0b — Messen** (zwei Wochen, nebenher) | Abfrageprotokoll auswerten: Fragen, Fallen, Verweigerungen | Eine Tabelle: welche der zehn Fallen fielen zu |
| **1 — Katalog** (2 Tage) | Migration: `mcp.*`, Rolle, Körnung von Hand für 165 Sichten — **auch in die Kommentare**, dann hat Metabase sie sofort | `psql` als `mcp_leser`: `core.betrieb` → *permission denied*, `mart.round_table_monat` → Zahlen; Körnung in jedem Kommentar |
| **2 — Prüfung** (2 Tage) | `abfrage_pruefen` mit Parser, `EXPLAIN`, Regeln aus `mcp.fallstrick`; Testdatei mit den zehn Fragen | Alle zehn: richtig oder gesperrt/gewarnt |
| **3 — Server** (2 Tage) | Skybridge-Gerüst, acht Werkzeuge, Befund-Anhang, Protokoll; Tunnel gegen Claude und ChatGPT | Zeile „Enchilada Bayreuth" im Chat = `migrations/pruefung.sql` |
| **4 — Ansicht** (1 Tag) | Ampelraster; Farben aus `ampel.regelwerk` | — |
| **5 — Betrieb** (1 Tag) | Dokploy-Application, IdP, Freischalten, `/status` | Vier Wochen später: `mcp.zugriff` ausgewertet |

Phase 1 hat auch dann Wert, wenn Stufe 1 nie gebaut wird: die Körnung in den Kommentaren
verbessert Metabase MCP, Metabase selbst und jeden Agenten im Repository.

---

## 10. Was der Plan nicht löst

1. Ein richtiges Ergebnis kann falsch gedeutet werden. Die Sperre verhindert die falsche
   Zahl, nicht den falschen Satz.
2. Die Abdeckungslücken bleiben — 60 von 141 Standorte, `pos_artikel` leer, Belegarchiv ein
   Torso. Der Server macht sie **sichtbarer**, füllt keine.
3. Kein Schreibzugriff.
4. Er ersetzt Metabase nicht: was sich wiederholt, gehört als Karte dorthin — das Protokoll
   sagt, was das ist.
5. Er ersetzt den Agenten im Repository nicht: alles, was `core`, den Importer oder eine
   neue Sicht braucht, bleibt Arbeit hier, mit `docs/` daneben.
6. Kosten entstehen im Abo des Nutzers, je Token. Die 500 Zeilen sind auch deshalb.

---

## 11. Was Eugene entscheiden muss

* **Stufe 0 jetzt starten?** Kostet einen halben Tag und liefert die Messung, auf der
  Stufe 1 steht.
* **Öffentlicher Hostname und TLS** für Metabase (Stufe 0) und später `mcp.<domain>`.
* **Wer bekommt SQL?** In Metabase: native-query-Recht je Gruppe. Vorschlag: Eugene, Daniel.
* **Identitätsanbieter für Stufe 1** — Entra, falls vorhanden.
* **Darf eine Zahl aus dem Chat das Haus verlassen?** Eine Frage an das Unternehmen; der
  Datenstand-Anhang beantwortet „war sie fertig", nicht „durfte sie raus".

---

## 12. Nebenbefund

Beim Versuch, den Katalog an einer frischen Datenbank zu messen, stellte sich heraus, dass
die Migrationen **aus dem Nichts nicht durchlaufen**: `0039_betriebsstatus_und_plausibilitaet`
braucht `gebinde` aus `0041`, `0039_einkaufspreis_belastbar` braucht `preis_je_einheit` aus
`0042`. In Produktion sind sie in der Reihenfolge ihres Erscheinens angewendet worden und
stehen; auf einer leeren Datenbank bricht `bun run migrate` bei der 40. Datei ab.
Nachgemessen 13.09.2026 auf PostgreSQL 16; Einzelheiten in `fehlerkatalog.md`. Für diesen
Plan wurde deshalb aus dem SQL-Text gezählt, nicht aus dem Katalog.

---

## 13. Die eine Entscheidung

> **Erst einschalten, was schon da ist, und zwei Wochen messen. Dann nur das bauen, was
> die Messung verlangt — und das mit Regeln auf dem Syntaxbaum, nicht mit Bitten im
> Prompt.**

Die semantische Schicht ist der Unterschied zwischen 90 und 98 Prozent — und zwischen einer
falschen Zahl und einer Verweigerung. Sie existiert in diesem Repository bereits, bis auf
die Körnung. Die Körnung ist zwei Tage Arbeit und nützt an drei Stellen gleichzeitig.
