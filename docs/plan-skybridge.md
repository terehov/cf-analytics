# Plan: die Daten selbst befragen — ein eigener MCP-Server neben und statt Metabase

Stand 13.09.2026. Dritte Fassung. Die erste (12.09.) und die zweite (13.09. früh) sind
überarbeitet; ihre Fehler stehen in Abschnitt 0 und bleiben in `entscheidungen.md`
durchgestrichen erhalten.

**Der Anlass:** Daniel und die OMs sollen jede Frage an die Daten selbst stellen können —
jede Gruppierung, jede Beziehung, nicht nur die 285 Fragen, die schon jemand als
Metabase-Karte gebaut hat — mit dem Werkzeug, das sie ohnehin benutzen: ChatGPT, Copilot
oder Claude. **Und zwar ohne Metabase:** der Server ist eine Alternative dazu, für Menschen
ohne Metabase-Zugang heute, und mit der Möglichkeit, Metabase später abzulösen.

---

## 0. Was diese Fassung anders sieht

**Die Zielsetzung, präzisiert am 13.09.2026 (Eugene):** der Server ist kein Zusatz zu
Metabase, sondern eine **Alternative** — für Nutzer ohne Metabase-Zugang sofort, und
perspektivisch als Ablösung. Daraus folgt, was die zweite Fassung falsch gewichtet hatte:

* **Metabases eingebauter MCP-Server ist nicht der Weg.** Er existiert (seit Version 60,
  unsere Instanz läuft auf v0.63) und wäre in einem halben Tag eingeschaltet — aber er
  braucht einen Metabase-Nutzer, seine Beziehungen liegen in Metabases Katalog, seine
  Rechte in Metabases Gruppen. Genau das soll wegfallen können. Er bleibt eine Notiz für
  den Fall, dass jemand ihn zum Vergleich einschalten will; gebaut wird darauf nichts.
* **Alles, was Metabase heute an Wissen hält, muss in die Datenbank oder ins Repository.**
  Die FK-Verdrahtung aus `beziehungen.ts` wird zur Tabelle `mcp.achse` — und Metabase
  liest sie künftig **von dort**, statt umgekehrt. Die Karten in `metabase/karten-*.ts`
  werden zur gemeinsamen Berichtsdefinition, aus der beide Oberflächen gespeist werden.
* **Der Server muss die Fragen der 285 Karten beantworten können, nicht nur neue.** Sonst
  ist er keine Alternative. Wie das ohne 285 Werkzeuge geht: Abschnitt 4.

Was aus der vertieften Recherche bleibt, jeder Punkt mit einer Zahl dahinter:

1. **Metabase muss nicht mehr die einzige Oberfläche sein, aber seine Karten sind das
   Beste, was dieses Repository hat.** Sie werden weiterverwendet — als Berichte
   (ein Werkzeug, 285 Schlüssel) und als Beispiele.
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
**Und neu: der Server hängt an nichts, was Metabase gehört.**

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

## 2. Was Metabase heute leistet — und was der Server davon übernehmen muss

Eine Alternative muss wissen, wofür sie Alternative ist. Was Metabase in diesem Projekt
tatsächlich tut, steht in `dashboards.md` und `metabase-sichtbarkeit.md`:

| Metabase heute | Übernimmt der Server so | Bleibt Metabase |
|---|---|---|
| 285 Karten auf ~40 Dashboards, natives SQL mit Parametern | `bericht_ausfuehren(schluessel, parameter)` — **ein** Werkzeug, dieselbe SQL, dieselben Parameter, aus `metabase/karten-*.ts` gelesen (Abschnitt 4) | — |
| Drill-Down Marke → Filiale → Betrieb mit mitlaufendem Filter | Die Ansicht trägt den Filter im Zustand (`state-and-context`); ein Klick auf eine Zeile ruft `bericht_ausfuehren` der nächsten Ebene über `useCallTool` | — |
| Werte-Auswahllisten (Betrieb, Marke, Regelwerk) | `betriebe_suchen`, `auswahl(liste)` aus `mart.regelwerk`, `mart.betrieb` | — |
| Tabelle, Balken, Linie, Kombi, Fläche, Punktwolke | React-Ansichten in Skybridge | — |
| Pivot Wochentag × Stunde, Wasserfall, Punktkarte | Pivot und Wasserfall als Ansicht; **Karte nicht** — `mart.standort` ist ohnehin für 81 von 141 leer | Karte, bis Standorte gepflegt sind |
| FK-Sprünge (`beziehungen.ts`) | `mcp.achse` — die Quelle, aus der `beziehungen.ts` künftig liest | — |
| Tabellen- und Spaltenbeschreibungen | Kommen aus dem Katalog, waren nie Metabases | — |
| Dashboard an der Wand, Dauer-URL, Abonnement per Mail, Filter über mehrere Karten | **Nicht.** Ein Chat ist kein Bildschirm im Büro und keine Montags-Mail | Solange jemand das braucht |
| Nutzer, Gruppen, Rechte | Identitätsanbieter + `mcp.nutzer_stufe` (Abschnitt 7) | — |
| Schreiben in `manual` (Maßnahmen, Ursachen, OM-Einschätzung) | **Nicht** (Abschnitt 7) | Ja — bis ein eigener Plan mit Bestätigungsschritt kommt |

**Die Folge für die Architektur:** die Karten sind heute Code, der Metabase provisioniert
(`metabase/uebernehmen.ts`). Sie werden zur **Berichtsdefinition mit zwei Abnehmern**:
`uebernehmen.ts` schreibt sie weiter nach Metabase, der MCP-Server liest sie beim Start.
Eine Karte, einmal gebaut, ist an beiden Orten da. Fällt Metabase weg, fällt nur ein
Abnehmer weg.

**Wann Metabase gehen kann,** ist keine Planfrage, sondern eine Messung: wenn Metabases
Anmeldeprotokoll über einen Monat nur noch Eugene zeigt und `mcp.zugriff` den Rest. Bis
dahin laufen beide, aus derselben Quelle.

**Zur Notiz:** Metabase 60+ bringt einen eigenen MCP-Server mit (`/api/metabase-mcp`,
OAuth aus Metabase, Rechte je Nutzer). Für dieses Ziel ungeeignet, weil er einen
Metabase-Nutzer voraussetzt und seine Beziehungen in Metabases Katalog hält — genau das,
was nicht mehr Voraussetzung sein soll. Wer ihn zum Vergleich einschalten will, kann das
in einer halben Stunde; die zehn Fallenfragen aus 6.3 taugen auch dafür.

---

## 3. Der Server (Skybridge)

Ein Dienst, drei Aufgaben: die Berichte, die Metabase heute zeigt; freie Fragen mit
Prüfung **vor** dem Lauf und Befund-Anhang **am** Ergebnis; und die Ansichten, ohne die
ein Ampelraster im Chat unlesbar wäre.

```
Daniel (Claude / ChatGPT / VS Code Copilot)
   │  MCP über HTTPS, OAuth
   ▼
mcp.<domain>            ← Skybridge-App, eigene Dokploy-Application
   │  Berichte (aus metabase/karten-*.ts) · Katalog · Prüfung · Ausführung
   │  Befund-Anhang · Ansichten · Protokoll
   ▼
PostgreSQL 18           ← Rolle `mcp_leser`: mart/manual/ampel/mcp, nur lesend
   ▲
   └── Metabase (solange es läuft) liest dieselben Karten und dieselben Achsen
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

## 4. Die Werkzeuge — zehn, nicht 285

Verb-basierte Namen, wie Skybridge sie empfiehlt; deutsch, weil das ganze Vokabular der
Datenbank deutsch ist und das Modell sonst übersetzt und dabei danebengreift.

| Werkzeug | Tut | Kanal |
|---|---|---|
| `berichte_suchen(stichwort)` | Die 285 Karten nach Name, Beschreibung, Dashboard — liefert Schlüssel und Parameter | Text |
| `bericht_ausfuehren(schluessel, parameter)` | **Die Metabase-Ablösung in einem Werkzeug.** Dieselbe SQL, dieselben Parameter, dieselbe Anzeigeart wie die Karte; Werte aus `werteliste`/`festeWerte` geprüft | Text + **Ansicht** je `anzeige` |
| `sichten_suchen(stichwort)` | Sichten samt Kommentar, Körnung, Achsen | Text |
| `sicht_beschreiben(name)` | Spalten mit Kommentar, Körnung, Achsen, Kennzahlen mit Aggregationsregel, **Fallstricke**, **Beispielabfragen aus den Karten**, drei Beispielzeilen | Text |
| `achsen_zeigen(sicht_a, sicht_b?)` | Worüber zwei Sichten zusammenfinden — oder alle Achsen einer Sicht | Text |
| `betriebe_suchen(text)` | Löst „Enchilada Karls" nach `betrieb_key` auf, mit Konzept, Status, Datenstand. Fünf Betriebe heißen „Karlsruhe" | Text |
| `abfrage_pruefen(sql)` | Parsen, Sichten erkennen, Regeln anwenden, `EXPLAIN` — **ohne zu laufen**. Liefert Hinweise und geschätzte Zeilen | Text |
| `abfrage_ausfuehren(sql)` | Prüfen, dann laufen. Ergebnis + `hinweise[]` + Datenstand der berührten Betriebe | Text + Tabelle |
| `datenstand(betrieb?)` | Was überhaupt beurteilbar ist | Text |
| `round_table(monat, konzept?, regelwerk?)` | Das Ampelraster — die eine Ansicht, die Text nicht kann; fachlich `bericht_ausfuehren('rt_eingabe')`, als eigenes Werkzeug, weil es die Frage ist, mit der jeder anfängt | **Ansicht** |

**Ein Werkzeug, 285 Berichte.** `bericht_ausfuehren` liest `Karte[]` aus
`metabase/karten-*.ts` — `schluessel`, `sql`, `parameter`, `anzeige`, `visualisierung`
sind schon da (`metabase/typen.ts`). Der Übersetzer ist dieselbe Datei wie für Metabase,
nur mit anderem Ziel: Metabase-Template-Tags (`{{monat}}`) werden zu `$1`, `werteliste`
wird zur Prüfung des Parameters gegen die Spalte, `anzeige` wählt die Ansicht. Das Modell
sieht ein Werkzeug mit einem Enum von 285 Schlüsseln, die es über `berichte_suchen`
findet — nicht 285 Werkzeugdefinitionen im Kontext.

**Und die Karten werden zu Beispielen.** `sicht_beschreiben('mart.personalkosten')` liefert
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
`beziehungen.ts` nutzt sie schon). **`beziehungen.ts` liest seine `ACHSEN` danach aus
`mcp.achse` statt aus einer Konstante** — die Datenbank ist die Quelle, Metabase ein
Abnehmer; sonst gäbe es zwei Wahrheiten über dieselbe Beziehung. `mcp.fallstrick` aus den 114 Kommentaren mit Warnwort
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

Sie sind die Regressionssicherung des ganzen Vorhabens und werden in Phase 3 als Testdatei
festgehalten. Jede muss entweder richtig
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

## 7. Anmeldung — ohne Metabase

Der Server hat eigene Nutzer, sonst wäre er keine Alternative. Ein Anbieter mit
Discovery-Dokument: gibt es bei Concept Family Microsoft 365 / Entra, ist das der richtige
(`customProvider({ issuer, audience })`) — Ausscheiden aus dem Unternehmen heißt dann
Zugangsverlust, und niemand pflegt eine zweite Nutzerliste. Sonst WorkOS oder Clerk mit
Allowlist. Die Identität kommt im Handler als `extra.http.authInfo.extra.subject` an und
steht in jeder Zeile von `mcp.zugriff`.

Rechte in `mcp.nutzer_stufe(subject, stufe)`:

| Stufe | Darf |
|---|---|
| `lesen` | Berichte, Katalog, Datenstand, Betriebe suchen |
| `fragen` | zusätzlich freies SQL |
| — | schreiben: niemand. `manual` bleibt Metabase und Postico, bis ein eigener Plan mit Bestätigungsschritt kommt |

**Was bewusst noch nicht kommt: Sicht je Betrieb.** Ein OM, der nur seine Betriebe sehen
darf, wäre Row-Level-Security auf `mart` — technisch möglich (`entscheidungen.md`,
„LINA-Login perspektivisch für RLS-Scope"), aber Metabase kann das heute auch nicht, und
eine Alternative muss zuerst gleichziehen. Steht in `offene-punkte.md` als Frage, nicht
als Phase.

---

## 8. Was in welchem Client ankommt

| | Claude | ChatGPT | Copilot (VS Code) |
|---|---|---|---|
| Remote-MCP mit OAuth | ja (Pro/Max/Team/Enterprise) | ja, Developer Mode oder Admin-Freigabe (Business/Enterprise) | ja |
| Skybridge-Ansichten (Tabelle, Chart, Ampel) | ja | ja | eingeschränkt — Daten statt Ansicht |
| Werkzeugobergrenze | ~100 | — | 128 |

Folge: jedes Werkzeug muss ohne seine Ansicht brauchbar sein — `bericht_ausfuehren` liefert
die Tabelle immer auch als `structuredContent`, gekürzt auf 500 Zeilen; die Ansicht ist die
Kür. Für Daniel ist ChatGPT der wahrscheinliche Einstieg, Claude der bessere Ort für die
Ampeltabellen.

---

## 9. Phasen

| Phase | Inhalt | Fertig, wenn |
|---|---|---|
| **1 — Katalog** (2 Tage) | Migration: `mcp.*`, Rolle `mcp_leser`; `beziehungen.ts` liest aus `mcp.achse`; Körnung von Hand für 165 Sichten — **auch in die Kommentare** | `psql` als `mcp_leser`: `core.betrieb` → *permission denied*, `mart.round_table_monat` → Zahlen; Körnung in jedem Kommentar; `bun run metabase/beziehungen.ts` unverändert im Ergebnis |
| **2 — Berichte** (2 Tage) | Skybridge-Gerüst, OAuth, `berichte_suchen`, `bericht_ausfuehren` über alle 285 Karten, Tabellen-Ansicht; Tunnel gegen Claude und ChatGPT | Zeile „Enchilada Bayreuth" im Chat = `migrations/pruefung.sql`; **jede** Karte läuft mit Standardparametern fehlerfrei (Testdatei) |
| **3 — Prüfung** (2 Tage) | `abfrage_pruefen` mit Parser, `EXPLAIN`, Regeln aus `mcp.fallstrick`; `abfrage_ausfuehren`; Befund-Anhang; Protokoll; Testdatei mit den zehn Fallenfragen | Alle zehn: richtig oder gesperrt/gewarnt |
| **4 — Ansichten** (2 Tage) | Ampelraster, Linie/Balken/Kombi, Drill-Down mit Filter im Zustand, Pivot; Farben aus `ampel.regelwerk` | Die fünf Drill-Down-Dashboards sind im Chat durchklickbar |
| **5 — Betrieb** (1 Tag) | Dokploy-Application, Hostname/TLS, IdP, `mcp.nutzer_stufe`, `/status`-Prüfzeile; Daniel und ein OM ohne Metabase-Zugang freigeschaltet, eine Seite „so fragt man" | — |
| **6 — Messen** (vier Wochen, nebenher) | `mcp.zugriff` gegen Metabases Anmeldeprotokoll: wer braucht Metabase noch, wofür | Eine Tabelle, die die Ablösefrage beantwortet |

**Gut anderthalb Wochen.** Phase 2 vor Phase 3, bewusst: die Berichte sind der Teil, der
Metabase ersetzt, und sie tragen kein Risiko einer falschen Zahl — es ist dieselbe SQL.
Das freie Fragen kommt danach, mit seinen Leitplanken.

---

## 10. Was der Plan nicht löst

1. Ein richtiges Ergebnis kann falsch gedeutet werden. Die Sperre verhindert die falsche
   Zahl, nicht den falschen Satz.
2. Die Abdeckungslücken bleiben — 60 von 141 Standorte, `pos_artikel` leer, Belegarchiv ein
   Torso. Der Server macht sie **sichtbarer**, füllt keine.
3. Kein Schreibzugriff.
4. Er ersetzt Metabase **nicht an der Wand**: ein Dashboard, das im Büro hängt oder montags
   per Mail kommt, ist kein Chat. Was sich im Chat wiederholt, gehört als Karte in
   `metabase/karten-*.ts` — dann ist es an beiden Orten. Das Protokoll sagt, was das ist.
5. Er ersetzt den Agenten im Repository nicht: alles, was `core`, den Importer oder eine
   neue Sicht braucht, bleibt Arbeit hier, mit `docs/` daneben.
6. Kosten entstehen im Abo des Nutzers, je Token. Die 500 Zeilen sind auch deshalb.

---

## 11. Was Eugene entscheiden muss

* **Identitätsanbieter** — Entra, falls vorhanden; sonst WorkOS oder Clerk. Ohne diese
  Antwort gibt es keine Nutzer ohne Metabase.
* **Öffentlicher Hostname und TLS** für `mcp.<domain>` — der erste Dienst dieses Projekts,
  der von außen erreichbar ist. Die Datenbank bleibt es nicht.
* **Wer bekommt freies SQL?** Vorschlag: Eugene, Daniel; alle anderen `lesen`.
* **Wer soll als Erster ohne Metabase arbeiten?** Ein OM als Pilot in Phase 5 sagt mehr als
  Daniel, der beides hat.
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

> **Die Karten sind die Berichtsdefinition, die Datenbank hält die Beziehungen, und beide
> Oberflächen — Metabase heute, der Chat morgen — lesen von dort. Freies Fragen bekommt
> Regeln auf dem Syntaxbaum, nicht Bitten im Prompt.**

So hängt der Server an nichts, was Metabase gehört, und Metabase kann gehen, wenn das
Protokoll sagt, dass niemand es mehr öffnet. Die semantische Schicht ist der Unterschied
zwischen 90 und 98 Prozent — und zwischen einer falschen Zahl und einer Verweigerung. Sie
existiert in diesem Repository bereits, bis auf die Körnung.
