# Plan: Skybridge — die Daten selbst befragen

Stand 12.09.2026.

**Der Anlass ist ein Engpass, kein fehlendes Feature.** Es gibt heute zwei Wege zu einer
Zahl, und beide gehen über jemanden, der vorher dafür gearbeitet hat:

| Weg | Was er kann | Wo er endet |
|---|---|---|
| **Metabase** — 285 Karten aus `metabase/` | Jede Frage, die schon jemand gestellt hat, sofort und richtig | Bei der 286. Frage |
| **Ein Agent im Repository** (Claude Code) | Auch neue Fragen, mit Zugriff auf `docs/` und die Rohdaten | Bei dem einen Menschen, der ihn startet und das Repository kennt |

Daniel hat eine Frage, die auf keiner Karte steht. Er hat ChatGPT, Copilot und Claude, und
er hat kein SQL, kein Repository und keinen Grund, auf Eugene zu warten.

Dieser Plan schließt diese Lücke: **ein MCP-Server über `mart`**, den Claude, ChatGPT und
Copilot als Connector einbinden, gebaut mit **Skybridge**. Er beschreibt dabei
ausdrücklich auch, was dabei **nicht** gebaut wird — der gefährlichste Teil dieses Vorhabens
ist nicht das, was es nicht kann, sondern das, was es falsch könnte.

---

## 1. Warum nicht einfach „die Datenbank an ChatGPT hängen"

Der naheliegende Bauplan ist ein Werkzeug `sql_ausfuehren(text)` auf einer Leseverbindung.
Zehn Zeilen Code, fertig in einer Stunde. **In genau dieser Datenbank ist er die falsche
Lösung**, und der Beleg dafür steht bereits geschrieben: `docs/fehlerkatalog.md`.

Dieses Projekt hat zwei Dutzend Fehler gemacht, und **fast keiner davon hat sich gemeldet**.
Kein Stacktrace, keine leere Ergebnismenge — eine plausibel aussehende falsche Zahl. Ein
Sprachmodell, das SQL schreibt, macht dieselben Fehler, nur schneller, häufiger und ohne
Commit-Nachricht:

| Falle | Was das Modell schreibt | Was herauskommt |
|---|---|---|
| `core.betrieb.stadt` ist bei **allen 141** Betrieben `NULL` | `GROUP BY stadt` | **Eine** Gruppe mit allen Betrieben. Keine Fehlermeldung |
| 79 der 141 Betriebe machen keinen Umsatz (Beteiligungsgesellschaften, Insolvenzen, Testeinträge), `aktiv` steht bei allen auf `true` | `avg(...) FROM ... betrieb` | Jeder Mittelwert um mehr als die Hälfte verdünnt |
| `mart.fremdeinkauf` führt mehrere `quelle`-Zeilen je Betrieb und Monat | `sum(netto) GROUP BY betrieb` | Doppelzählung |
| `mart.einkaufspreis_betrieb` ist nur mit `vergleichbar = true` lesbar — und sein Tabellenkommentar widerspricht an drei Stellen der gebauten Sicht (Befund 12.08.2026) | Preisvergleich über alle Zeilen | Ein Betrieb sieht teuer aus, weil er andere Gebinde kauft |
| Prozentwerte sind Prozentzahlen (`23.64`), das Excel speichert Brüche (`0.2364`) | `wert * 100` | Faktor-100-Fehler in beide Richtungen |
| Der BWA-Versatz ist **je Betrieb verschieden** (Juni 2026: am 25.07. erst 22 von 131 gebucht) | Join auf `date_trunc('month', tag)` | Personalquote gegen den falschen Monat |
| `core.pos_artikel` und `core.rezept` sind **leer** (nachgezählt 14.08.2026) | Join Verkauf → Rezept → Ware | Null Zeilen, kein Fehler |
| Stände gelten über Zeiträume, nicht über Monatsgleichheit | `stand.monat = date_trunc(...)` | `NULL`-Wareneinsatz, sieht aus wie „nicht gepflegt" |
| LINAs Warenwirtschaft ist **Demodaten** (harte Regel 5) | `SELECT ... FROM core.wawi_*` | Erfundene Zahlen, korrekt summiert |

Jede dieser Fallen ist in `mart` bereits ausgeräumt — dafür ist die Schicht da. Der Grundsatz
aus `metabase.md` gilt deshalb hier unverändert und wird zur **tragenden Entscheidung dieses
Plans**:

> **Der MCP-Server sieht `mart`, `manual` und `ampel`. Sonst nichts.**

Wer in `core` joinen muss, um eine Frage zu beantworten, hat eine Lücke in `mart` gefunden —
dann gehört dort eine Sicht hin. Das ist keine Bequemlichkeit, es ist der einzige Ort, an dem
dieses Wissen bereits vollständig und gepflegt vorliegt.

---

## 2. Der Hebel, den wir schon haben

Der eigentliche Grund, warum dieses Vorhaben tragfähig ist: **das Wissen, das ein
Sprachmodell braucht, ist bereits geschrieben — und zwar dort, wo es maschinell abholbar
ist.**

| Bestand | Anzahl | Wo |
|---|---|---|
| `mart`-Sichten mit Tabellenkommentar | **178** | `COMMENT ON VIEW` in den Migrationen |
| Materialisierte Sichten mit Kommentar | 12 | dito |
| Spaltenkommentare in `mart` | 46 | dito |
| Geprüfte, parametrisierte SQL-Karten | **285** | `metabase/karten-*.ts` |
| Fachdokumentation | ~24.000 Zeilen | `docs/`, `AGENTS.md` |

Diese Kommentare sagen nicht nur, was eine Sicht enthält. Sie sagen, **was man mit ihr nicht
tun soll** — „immer auf genau eine `quelle` filtern", „nur mit `vergleichbar = true` lesen",
„die beiden Spalten dürfen nicht verwechselt werden". Die Dokumentationspflicht aus
`AGENTS.md` hält sie aktuell.

Ein Sprachmodell, das diese Kommentare zusammen mit dem Schema bekommt, ist kein raten des
Datenmodells mehr — es liest dieselbe Warnung wie ein Mensch in Postico. **Der MCP-Server ist
im Kern ein Zustellweg für diese Kommentare**, nicht für die Tabellen.

---

## 3. Was Skybridge ist

[Skybridge](https://github.com/alpic-ai/skybridge) (MIT, von Alpic) ist ein
TypeScript-Framework für MCP-Server **mit Oberfläche**: man registriert Werkzeuge auf einem
Express-basierten MCP-Server und hängt an jedes Werkzeug eine React-Ansicht, die **im Chat
selbst** gerendert wird. Typinferenz läuft durchgehend vom Werkzeug bis in die Ansicht.
Dazu: lokaler Emulator, Hot Reload und ein Tunnel, mit dem die lokale Fassung direkt gegen
echtes Claude und echtes ChatGPT getestet werden kann.

**Warum das hier und nicht das nackte MCP-SDK:**

1. **Eine Ampel ist eine Farbe, keine Zeichenkette.** Der Round Table ist ein Raster aus
   rot/orange/grün. Als Text im Chat ist er unlesbar; als gerenderte Tabelle ist er das
   Produkt. Genau das ist Skybridges Zweck.
2. **Ein Codestand für drei Clients.** Die Unterschiede zwischen Claude, ChatGPT und VS Code
   abstrahiert das Framework; wir schreiben die Werkzeuge einmal.
3. **Der Tunnel spart die Runde über ein Deployment.** Eine Änderung an einem Werkzeug lässt
   sich in echtem Claude prüfen, bevor irgendetwas auf dem Hetzner-Server steht.
4. **TypeScript und Zod** sind bereits der Stack dieses Repositories (`src/lina/schemas.ts`,
   `src/config.ts`) — kein zweites Ökosystem.

**Was Skybridge nicht ist:** kein Datenzugriff, kein Sicherheitsmodell, keine Fachlogik.
Alles, was die Zahlen richtig macht, bauen wir — Skybridge liefert die Hülle und die
Oberfläche.

---

## 4. Architektur

```
Daniel (Claude / ChatGPT / VS Code Copilot)
   │  MCP über HTTPS, OAuth
   ▼
mcp.<domain>            ← Skybridge-App, Dokploy-Application, eigener Container
   │  Werkzeuge, Ansichten, Befund-Anhang, Protokoll
   ▼
PostgreSQL 18           ← Rolle `mcp_leser`: nur mart/manual/ampel, nur lesend
   ▲
   │
Importer (bestehend)    ← unverändert, schreibt weiter
```

**Ein eigener Container neben dem Importer, kein Endpunkt in `src/health.ts`.** Der Importer
ist ein Batch-Prozess, der nachts läuft und dessen Container bewusst „oben bleibt und nichts
tut" (`src/health.ts`). Ein Webdienst mit Publikumsverkehr gehört nicht in denselben Prozess:
er hat einen anderen Lastverlauf, ein anderes Neustartverhalten und ein völlig anderes
Risikoprofil. Dokploy trennt sie ohnehin sauber — dasselbe Muster wie Metabase
(`docs/architektur.md`).

**Warum selbst gehostet und nicht auf Alpic.** Alpic wäre bequemer (Deploy aus dem
Repository, MCP-Analytics, SOC 2). Es scheitert an einem Satz: **die Datenbank ist nicht von
außen erreichbar, und sie soll es nicht werden.** Eine gehostete App außerhalb des
Hetzner-Servers braucht genau das — oder einen Tunnel, der dasselbe Loch mit mehr beweglichen
Teilen ist. Der Server, auf dem Postgres und Metabase schon stehen, ist der richtige Ort.
Skybridge ist dafür ausdrücklich vorgesehen („self-host on any Node.js-compatible platform").

Alpic bleibt als Option für **Phase 1** (Tunnel zum Testen gegen echtes Claude/ChatGPT vom
Entwicklungsrechner aus) — dort fließen nur Testdaten und keine Datenbankverbindung.

---

## 5. Die Werkzeuge — drei Ringe

Nicht ein Werkzeug „frag die Datenbank", sondern drei Ringe mit abnehmender Sicherheit und
zunehmender Freiheit. Die meisten Fragen enden im ersten Ring.

### Ring 1 — Fertige Fragen (die 285 Karten)

Die Metabase-Karten sind bereits **parametrisiertes, geprüftes SQL mit typisierten
Parametern** (`metabase/typen.ts`: `Parameter`, `werteliste`, `festeWerte`). Sie sind das
Beste, was dieses Repository hat, und sie sind heute nur in Metabase abrufbar.

Aus jeder Karte wird ein MCP-Werkzeug — dieselbe SQL, dieselben Parameter, kein Modell, das
etwas generiert:

| Werkzeug | Parameter | Liefert |
|---|---|---|
| `round_table` | `monat`, optional `konzept`, `regelwerk` | Das Ampelraster, gerendert |
| `betriebsblatt` | `betrieb`, `monat` | Kennzahlen, Verlauf, Personal, Ware, BWA |
| `umsatz_verlauf` | `betrieb`/`konzept`, `von`, `bis` | Zeitreihe als Chart |
| `marke_vergleich` | `monat`, `kennzahl` | Betrieb gegen Markenmedian |
| `standorte_vergleichen` | `betriebe[]`, `zeitraum` | Mehrere Betriebe nebeneinander |
| `datenstand` | optional `betrieb` | **Was überhaupt beurteilbar ist** |
| `import_lage` | — | Läuft der Import, was fehlt |

`werteliste` wird zum Auswahl-Werkzeug (`betriebe_suchen("Enchilada Karls")`) — dieselbe
Falle wie in Metabase: **der Betriebsname ist nicht eindeutig**, fünf Betriebe heißen
„Karlsruhe". Aufgelöst wird immer über `betrieb_key`, angezeigt mit Konzept davor.

**Der Aufwand ist gering, weil die Karten schon als Daten vorliegen.** Ein Übersetzer von
`Karte` nach MCP-Werkzeugdefinition ist eine Datei, kein Projekt — dasselbe Muster wie
`metabase/uebernehmen.ts`, nur mit einem anderen Ziel.

### Ring 2 — Katalog

Damit das Modell die Lücke zwischen Ring 1 und Ring 3 überhaupt sieht:

| Werkzeug | Liefert |
|---|---|
| `sichten_suchen(stichwort)` | Passende `mart`-Sichten mit ihrem Tabellenkommentar |
| `sicht_beschreiben(name)` | Spalten, Typen, Spaltenkommentare, Zeilenzahl, **Fallstricke**, Beispielzeilen |
| `befunde_lesen(thema)` | Die einschlägigen Absätze aus `befunde-datenlage.md` und `fehlerkatalog.md` |

`sicht_beschreiben` ist das wichtigste Werkzeug des ganzen Servers. Es beantwortet die Frage,
die vor jedem SQL steht — und es beantwortet sie mit dem Kommentar, der neben den Daten in
der Datenbank steht und von der Dokumentationspflicht aktuell gehalten wird.

### Ring 3 — Freies SQL, mit Leitplanken

`abfrage_ausfuehren(sql)` — für alles, was Ring 1 nicht abdeckt. Die Leitplanken stehen in
Abschnitt 6 und sind **keine Prompt-Anweisungen**.

---

## 6. Leitplanken, die nicht im Prompt stehen

Eine Regel, die nur im Systemprompt steht, ist eine Bitte. Alles Folgende ist erzwungen.

### 6.1 Die Datenbankrolle

```sql
CREATE ROLE mcp_leser LOGIN PASSWORD :'pw';
ALTER ROLE mcp_leser SET default_transaction_read_only = on;
ALTER ROLE mcp_leser SET statement_timeout = '20s';
ALTER ROLE mcp_leser SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE mcp_leser SET work_mem = '32MB';

REVOKE ALL ON SCHEMA public, raw, part, core, sync FROM mcp_leser;
GRANT USAGE ON SCHEMA mart, manual, ampel TO mcp_leser;
GRANT SELECT ON ALL TABLES IN SCHEMA mart, manual, ampel TO mcp_leser;
ALTER DEFAULT PRIVILEGES IN SCHEMA mart GRANT SELECT ON TABLES TO mcp_leser;
```

**Warum die Rolle und nicht eine Prüfung im Code:** ein SQL-Parser, der `core` verbieten
soll, ist eine Liste von Umgehungen, die man nicht kennt (CTE, Funktion, `search_path`,
Kommentartrick). Postgres hat diese Prüfung eingebaut und sie ist vollständig. Der
Code-Filter kommt trotzdem dazu — als **erste** Hürde mit einer verständlichen Meldung, nicht
als einzige.

**Der Importer behält seine eigene Rolle.** `DATABASE_URL` und die MCP-Verbindung teilen
keinen Zugang; der Server bekommt eine eigene Umgebungsvariable (`MCP_DATABASE_URL`). Harte
Regel 2 gilt unverändert.

### 6.2 Grenzen am Ergebnis

| Grenze | Wert | Warum |
|---|---|---|
| Zeilen je Antwort | 500, hart abgeschnitten mit Hinweis | `mart.umsatz_tag` hat 443.304 Zeilen. Eine unbegrenzte Antwort sprengt das Kontextfenster und kostet Geld, bevor sie irgendetwas beantwortet |
| Laufzeit | 20 s (`statement_timeout`) | Ein Modell wartet nicht, es probiert etwas anderes |
| Gleichzeitige Abfragen je Nutzer | 2 | Der Server teilt sich die Maschine mit dem Importer |
| Nur `SELECT`/`WITH` | Codefilter **und** Leserolle | siehe oben |

### 6.3 Der Befund-Anhang — die eigentliche Erfindung

**Jede Antwort trägt die Fallstricke der berührten Sichten bei sich.** Nicht als Hoffnung,
dass das Modell den Kommentar gelesen hat, sondern als Feld `hinweise[]` neben den Daten,
maschinell angehängt anhand der Sichten, die in der Abfrage vorkommen.

```
{ zeilen: [...], hinweise: [
    "mart.fremdeinkauf: ohne Filter auf genau eine quelle zählt diese Abfrage doppelt.",
    "stadt ist bei allen 141 Betrieben NULL — GROUP BY stadt ergibt eine Gruppe.",
    "Stand: Umsatz bis 10.09.2026, BWA bis 07/2026 (je Betrieb verschieden, siehe datenstand)." ] }
```

Die Fallstricke liegen **als Daten** in `mcp.fallstrick` (Sicht, optional Spalte, optional
Bedingung, Text) — nicht als `if` im Code. Dasselbe Muster wie die Ampelregelwerke
(`datenmodell.md`, Entscheidung 5): eine neue Warnung ist eine Migration, kein Deploy, und
sie steht neben den Daten, auf die sie sich bezieht. Erstbefüllung aus den vorhandenen
Tabellenkommentaren und `fehlerkatalog.md`.

**Das ist harte Regel 10, angewandt auf Auswertungen:** eine stille Falle muss im Ergebnis
sichtbar werden, nicht in einem Dokument, das niemand liest.

### 6.4 Der Datenstand hängt immer dran

`mart.datenstand` beantwortet, welche Zeilen überhaupt beurteilbar sind — LINA liefert
5–6 Tage nach, die BWA je Betrieb verschieden weit. In Metabase ist das eine Karte, die man
aufrufen kann. Hier ist es **kein eigener Schritt**: jede Antwort, die Betriebe enthält,
trägt den Datenstand der betroffenen Betriebe im Anhang. Wer die Juli-Zahlen eines Betriebs
zieht, dessen BWA bei Mai steht, sieht das in derselben Antwort.

### 6.5 Protokoll

Neues Schema `mcp` (Schichtname, deshalb englisch — dieselbe Begründung wie `raw`, `sync`,
`mart`), eine Tabelle:

```
mcp.zugriff(id, zeitpunkt, nutzer, client, werkzeug, parameter jsonb,
            sql text, zeilen int, dauer_ms int, fehler text)
```

Zwei Gründe, beide aus diesem Repository:

1. **Wenn eine Zahl im Round Table landet, muss rekonstruierbar sein, woher sie kam.** Eine
   Chat-Antwort ist kein Beleg; die Zeile in `mcp.zugriff` ist einer.
2. **Ein Dienst ohne Zulauf ist ein Fehler, kein Normalzustand** (harte Regel 10). Wird der
   Server nicht benutzt, muss man das sehen — in `mart.mcp_nutzung` und in `/status`, nicht
   im Gefühl. Und wenn dieselbe Frage zwanzigmal über Ring 3 gestellt wird, gehört sie als
   Karte nach Ring 1 und als Sicht nach `mart`.

Aus Punkt 2 folgt der Rückkanal, der dieses Vorhaben davor bewahrt, ein Spielzeug zu
bleiben: **`mcp.zugriff` ist die Anforderungsliste für die nächsten `mart`-Sichten.**

---

## 7. Anmeldung und wer was darf

Skybridge bringt OAuth-Beispiele für Clerk, Auth0, Descope, WorkOS, Stytch und Authplane mit;
alle drei Zielclients sprechen OAuth 2.1 + PKCE nach der MCP-Autorisierungsspezifikation.

**Vorschlag: ein Anbieter mit Allowlist, keine eigene Nutzerverwaltung.** Bei einer
Handvoll Menschen (Eugene, Daniel, die OMs) ist eine Nutzerdatenbank Aufwand ohne Gegenwert.
Entscheidungsbedarf besteht nur an einer Stelle — ob Concept Family bereits ein
Identitätssystem hat, an das sich das hängen lässt (Microsoft 365 / Entra ist die
wahrscheinlichste Antwort und wäre die beste: dann ist Ausscheiden aus dem Unternehmen
gleichbedeutend mit Zugangsverlust). Das steht in `offene-punkte.md`.

**Rechte in Stufen, erst wenn jemand sie braucht:**

| Stufe | Wer | Darf |
|---|---|---|
| `lesen` | alle Freigeschalteten | Ring 1 und 2 |
| `fragen` | Eugene, Daniel | zusätzlich Ring 3 (freies SQL) |
| — | niemand | schreiben. `manual.*` bleibt Metabase und Postico |

**Kein Schreibzugriff, bewusst.** Maßnahmen, Ursachen und OM-Einschätzungen sind das einzige,
was hier von Hand entsteht. Ein Modell, das sie anlegt, erzeugt Einträge, die niemand
verantwortet — und `manual` ist das Schema, das ein Backfill nicht wiederherstellen kann.
Wenn das kommt, dann als eigener Plan mit Bestätigungsschritt, nicht nebenbei.

---

## 8. Was in welchem Client ankommt

Ehrlich, weil die Unterschiede echt sind:

| | Claude | ChatGPT | Copilot (VS Code) |
|---|---|---|---|
| Remote-MCP-Connector | ja (Pro/Max/Team/Enterprise) | ja — Developer Mode (Pro/Plus/Business/Enterprise), org-weit über Admin | ja, OAuth 2.1 + PKCE |
| OAuth | ja | ja | ja |
| **Gerenderte Ansichten** (Ampeltabelle, Chart) | ja | ja | eingeschränkt — Werkzeugergebnisse als Daten |
| Einrichtung durch | Nutzer | Admin (Business/Enterprise) oder Nutzer | `mcp.json` im Arbeitsbereich |

**Folge für den Bau:** jedes Werkzeug muss auch **ohne** Ansicht eine brauchbare Antwort
liefern. Die Ansicht ist die Kür, die strukturierte Antwort die Pflicht — sonst ist der
Server in Copilot wertlos. Das ist ohnehin Skybridges Modell (`structuredContent` neben der
Ansicht), es muss nur beim Schneiden der Antworten eingehalten werden.

Für Daniel ist **ChatGPT der wahrscheinliche Einstieg** und Claude der bessere Ort für die
Ampeltabellen. Beide werden bedient, keiner wird bevorzugt.

---

## 9. Phasen

Jede Phase endet an etwas Vorzeigbarem. Keine Phase beginnt, bevor die vorige gemessen ist.

### Phase 0 — Der Zugang (½ Tag)
* Migration: Rolle `mcp_leser`, Schema `mcp`, `mcp.zugriff`, `mcp.fallstrick`
* `mart.mcp_nutzung` und eine Prüfzeile in `/status`
* **Fertig, wenn** `psql` als `mcp_leser` ein `SELECT` auf `core.betrieb` mit
  *permission denied* beantwortet und eines auf `mart.round_table_monat` mit Zahlen.

### Phase 1 — Der schmale Server (2–3 Tage)
* Skybridge-Gerüst, Ring 2 vollständig (`sichten_suchen`, `sicht_beschreiben`)
* Ring 1 mit **sechs** Werkzeugen: `round_table`, `betriebsblatt`, `umsatz_verlauf`,
  `datenstand`, `betriebe_suchen`, `import_lage`
* Über den Tunnel gegen echtes Claude **und** echtes ChatGPT geprüft
* **Fertig, wenn** die Ampelzeile „Enchilada Bayreuth" im Chat dieselben zehn Werte zeigt wie
  `migrations/pruefung.sql` gegen das Excel. Dieselbe Prüfzeile wie beim Round Table selbst —
  sie ist die verbindliche Zieldefinition und bleibt es.

### Phase 2 — Freies SQL mit Leitplanken (2 Tage)
* `abfrage_ausfuehren` mit Codefilter, Zeilengrenze, Protokoll
* Befund-Anhang, erstbefüllt aus Tabellenkommentaren und `fehlerkatalog.md`
* **Fertig, wenn** zehn bewusst gestellte Fallenfragen (die Tabelle aus Abschnitt 1) entweder
  richtig beantwortet werden oder eine Warnung tragen. Diese zehn Fragen werden als
  Testdatei festgehalten — sie sind die Regressionssicherung des ganzen Vorhabens.

### Phase 3 — Ansichten (2 Tage)
* Ampelraster, Zeitreihe, Vergleichstabelle als React-Ansichten
* Farben und Schwellen aus `ampel.regelwerk`, nicht neu erfunden

### Phase 4 — Betrieb und Ausrollen (1 Tag)
* Dokploy-Application, eigener Container, Healthcheck
* Daniel wird freigeschaltet, mit einer Seite „so fragt man"
* **Messen statt hoffen:** nach vier Wochen `mcp.zugriff` auswerten — welche Fragen kamen,
  welche über Ring 3, welche davon gehören als Sicht nach `mart`.

**Gesamt: gut eine Woche Arbeit.** Der größte Posten ist nicht der Server, sondern Phase 2 —
die Leitplanken und ihre Prüfung.

---

## 10. Was dieser Plan nicht löst

Damit niemand es später als Überraschung erlebt:

1. **Ein richtiges Ergebnis kann falsch gedeutet werden.** Der Befund-Anhang warnt vor
   bekannten Fallen. Er kann nicht verhindern, dass jemand eine korrekte Zahl in einen
   falschen Satz packt. Die Ampel ersetzt kein Urteil.
2. **Die Abdeckungslücken bleiben.** 60 von 141 Betrieben haben einen gepflegten Standort,
   `core.pos_artikel` ist leer, das Belegarchiv ist ein Torso, Inventuren sind praktisch nur
   bei Wilma Wunder belastbar. Der MCP-Server macht diese Lücken **sichtbarer** — er füllt
   keine.
3. **Kein Schreibzugriff** (Abschnitt 7).
4. **Er ersetzt Metabase nicht.** Ein Dashboard, das jeden Monat dieselbe Frage beantwortet,
   ist einer Chat-Antwort überlegen: reproduzierbar, teilbar, ohne Kosten je Aufruf. Der
   MCP-Server ist für die Fragen **davor** und **danach** — und was sich wiederholt, gehört
   als Karte nach Metabase. `mcp.zugriff` sagt, welche das sind.
5. **Er ersetzt den Agenten im Repository nicht.** Alles, was `raw`, `core`, den Importer
   oder eine neue `mart`-Sicht braucht, bleibt Arbeit im Repository, mit `docs/` daneben.
6. **Kosten entstehen beim Nutzer, nicht bei uns** — jede Abfrage kostet Tokens in Daniels
   Abo. Die Zeilengrenze ist auch deshalb keine Schikane.

---

## 11. Was Eugene entscheiden muss

Übernommen nach `offene-punkte.md`:

* **Identitätsanbieter** — gibt es Microsoft 365 / Entra bei Concept Family, an das sich der
  Zugang hängen lässt? Sonst WorkOS oder Clerk mit Allowlist.
* **Wer bekommt Ring 3?** Freies SQL ist mächtig und die Leitplanken sind Technik, kein
  Urteil. Vorschlag: zunächst Eugene und Daniel.
* **Öffentlicher Hostname und TLS** für `mcp.<domain>` — Claude und ChatGPT verbinden von
  außen, anders als Metabase, das heute hinter dem Dokploy-Proxy liegt.
* **Darf Daniel Zahlen aus dem Chat weitergeben?** Das ist eine Frage an das Unternehmen,
  keine technische. Der Datenstand-Anhang ist die Antwort auf „war die Zahl überhaupt
  fertig", nicht auf „durfte sie raus".

---

## 12. Die eine Entscheidung, auf die alles zurückfällt

Wenn von diesem Plan ein Satz überleben soll, dann dieser:

> **Nicht die Datenbank wird angeschlossen, sondern `mart` — und mit jeder Antwort reist der
> Kommentar mit, der sagt, was man mit ihr nicht tun darf.**

Alles andere in diesem Dokument ist Ausführung. Diese Entscheidung ist der Unterschied
zwischen einem Werkzeug, das Daniel schneller macht, und einem, das schneller falsche Zahlen
produziert, als irgendjemand sie prüfen kann.
