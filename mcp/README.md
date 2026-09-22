# Der MCP-Zugang

Die Zahlen der Concept Family AG aus **Claude, ChatGPT und GitHub Copilot**
befragen — ohne Zugang zum BI-Tool. Plan und Begründung: [`docs/plan-skybridge.md`](../docs/plan-skybridge.md).

> **Sprachregelung.** „BI-Tool" meint die Auswertungsoberfläche des Unternehmens — heute
> Metabase. Wo der Produktname fällt, geht es um eine konkrete Eigenschaft dieses Produkts
> (ein Verzeichnis, ein Platzhalterformat), nicht um die Rolle.

## Was er ist

Ein MCP-Server (Skybridge) mit zehn Werkzeugen auf der Auswertungsschicht:

| Werkzeug | Wofür |
|---|---|
| `berichte_suchen` · `bericht_ausfuehren` | Die 285 fertigen Berichte — dieselben, die die Dashboards im BI-Tool zeigen |
| `sichten_suchen` · `sicht_beschreiben` · `achsen_zeigen` | Der Katalog: Körnung, Spalten, Achsen, Fallstricke, Beispielabfragen |
| `betriebe_suchen` · `datenstand` | Wer ist gemeint, und was ist überhaupt beurteilbar — `datenstand` nennt seit 23.09.2026 auch je Betriebsbericht den geladenen Zeitraum |
| `abfrage_pruefen` · `abfrage_ausfuehren` | Freies SQL — mit Prüfung auf dem Syntaxbaum **und** gegen die Datenbank (`EXPLAIN`, seit 21.09.2026) |
| `round_table` | Das Ampelraster als Ansicht |

**Zehn, nicht 285.** Jede Werkzeugbeschreibung kostet ein Modell 300–600 Token,
bevor die erste Frage gestellt ist; Cursor kappt bei 40 Werkzeugen, Copilot bei
128, Claude Desktop um 100, und die Antwortqualität sinkt messbar ab etwa 50.
Die Karten sind deshalb *ein* Werkzeug mit 285 Schlüsseln.

## Die vier Riegel

1. **Die Rolle.** `mcp_leser` sieht `mart`, `manual`, `ampel`, `mcp` — sonst
   nichts, nur lesend, mit `statement_timeout`. Ein SQL-Filter im Code wäre
   eine Liste von Umgehungen, die man nicht kennt; Postgres' Prüfung ist
   vollständig.
2. **Der Prüfer.** Jede freie Abfrage wird mit dem Parser von PostgreSQL selbst
   zerlegt und gegen `mcp.fallstrick` gehalten. Eine bekannte Falle wird
   **gesperrt**, mit Grund und meist mit der Berichtigung. Das ist die
   Verweigerung statt der selbstbewusst falschen Zahl.
3. **Die Transaktion.** Jede freie Abfrage läuft in `BEGIN READ ONLY` mit
   `SET LOCAL statement_timeout` und endet mit `ROLLBACK` — auch bei Erfolg.
   Was eine Abfrage an der Sitzung ändert (`set_config`), nimmt Postgres
   damit zurück, bevor die Verbindung an die nächste geht. Der Prüfer sperrt
   solche Funktionen zusätzlich; dieser Riegel hält auch ohne ihn.
4. **Der Befund-Anhang.** Jede Antwort trägt die Fallstricke der berührten
   Sichten, ihre Körnung und den Datenstand bei sich — nicht als Hoffnung,
   dass jemand den Tabellenkommentar gelesen hat.
   Wer eine Kassensicht liest (Betriebsberichte, `0117`), bekommt dazu den
   Ladestand des Berichts: ein Monat ohne Zeilen ist dort nicht null, sondern
   nicht geladen.

## Anmeldung — ohne fremden Anbieter

Dieser Server ist sein **eigener** Autorisierungsserver: OAuth 2.1 mit PKCE,
Passwörter als argon2id-Hash in Postgres, Nutzer in `mcp.nutzer`.

*Warum nicht Entra, WorkOS oder Auth0:* bei drei Nutzern ist ein Vertrag mehr
Aufwand als Gewinn — und Entra hätte gar nicht funktioniert. ChatGPT meldet
sich beim Verbinden per **Dynamic Client Registration** selbst an, und Entra
hat dafür keinen Endpunkt. Hier ist die Registrierung ein Endpunkt von
zwanzig Zeilen.

*Was das kostet, ehrlich:* kein zweiter Faktor, keine Passwortrücksetzung per
Mail, und **kein automatischer Entzug beim Austritt** — wer geht, muss hier
auf `aktiv = false` gesetzt werden.

### Zwei Datenbankrollen, und warum das kein Umstand ist

`mcp_leser` führt Nutzereingaben als SQL aus, und `mcp` ist ein erlaubtes
Schema. Lägen Passworthashes und Signierschlüssel unter derselben Rolle, wäre
`SELECT privat_jwk FROM mcp.oauth_schluessel` eine gültige Abfrage — und wer
sie stellt, stellt sich fortan selbst Tokens aus. Deshalb:

| Rolle | Sieht | Sieht nicht |
|---|---|---|
| `mcp_leser` | `mart`, `manual`, `ampel`, den Katalog in `mcp` | die Anmeldetabellen |
| `mcp_anmeldung` | `mcp.nutzer`, `mcp.oauth_*` | die Auswertungsdaten |

Beides ist in `test/ausfuehren.test.ts` und `test/anmeldung.test.ts` gemessen,
nicht behauptet.

## Einrichten

```bash
# 1. Migrationen (legen Schema mcp und beide Rollen an)
bun run migrate

# 2. Einmal von Hand, als Datenbankadministrator:
#    ALTER ROLE mcp_leser     LOGIN PASSWORD '...';
#    ALTER ROLE mcp_anmeldung LOGIN PASSWORD '...';
#    Solange das fehlt, meldet es /status und mcp.einrichtung_offen.

# 3. Umgebung (mcp/.env oder Dokploy)
MCP_DATABASE_URL=postgresql://mcp_leser:...@host/lina
MCP_AUTH_DATABASE_URL=postgresql://mcp_anmeldung:...@host/lina
MCP_OEFFENTLICHE_URL=https://mcp.concept-family.de

# 4. Nutzer anlegen — das Passwort wird abgefragt, nie als Argument übergeben
bun run nutzer anlegen eugene@brain.food "Eugene" fragen
bun run nutzer anlegen daniel@brain.food "Daniel" lesen

bun install && bun run build && bun run start
```

### Nutzer verwalten

```bash
bun run nutzer liste
bun run nutzer stufe    daniel@brain.food fragen   # wirkt sofort, nicht erst beim nächsten Token
bun run nutzer passwort daniel@brain.food          # widerruft bestehende Tokens
bun run nutzer sperren  daniel@brain.food          # stilllegen + alle Tokens widerrufen
```

## Befehle

```bash
bun test                 # 417 Tests ohne Datenbank, 462 mit (23.09.2026): Fallenfragen, Umgehungen, Anmeldeablauf, Spaltenprofil
bun run typecheck
bun run build            # die Ansichten (vite) — vor dem ersten Start noetig
bun run start            # Produktionsstart; Port aus __PORT, nicht PORT
bun run dev              # mit Neuladen
bun run katalog:abzug    # test/katalog.json aus der Datenbank neu ziehen
```

Die Datenbanktests laufen nur mit gesetzter Variable — und zwar bewusst
**als `mcp_leser`**, nicht als Eigentuemer: die Haelfte dessen, was sie
pruefen, ist die Rolle selbst.

```bash
MCP_DATABASE_URL=postgresql://mcp_leser:...@host/lina \
MCP_AUTH_DATABASE_URL=postgresql://mcp_anmeldung:...@host/lina bun test
```

## Den Katalog pflegen

Der Katalog ist **Daten, kein Code** — eine neue Warnung ist eine Migration,
kein Deploy (dieselbe Begründung wie bei den Ampelregelwerken).

| Was | Wo |
|---|---|
| Körnung einer Sicht („eine Zeile je …") | `mcp.sicht.koernung`; fehlende stehen in `mcp.koernung_fehlend` |
| Wie eine Spalte aggregiert werden darf | `mcp.kennzahl` |
| Eine neue Falle | `mcp.fallstrick` — `art` muss in `src/pruefen.ts` umgesetzt sein, **sonst startet der Server nicht** |
| Beziehungen | `mcp.achse`; `metabase/beziehungen.ts` liest von dort |

**Rechte im Schema `mcp` werden namentlich vergeben.** Wer eine Katalogtabelle
ergänzt, trägt sie in `mcp.rechte_auffrischen()` ein (Migration `0105`); eine
neue Tabelle ist sonst für keine Rolle lesbar — absichtlich. `mart.mcp_rechte_pruefung`
muss leer sein.

Nach jeder Migration, die eine `mart`-Sicht anlegt:

```sql
SELECT mcp.achsen_ableiten();        -- neue Sichten und Achsen nachführen
SELECT mcp.koernung_in_kommentare(); -- Körnung in die Tabellenkommentare
```

## Wer die Diagramme malt

**Das Modell — nicht dieser Server.** Er zeichnet nichts und schreibt keine Form vor. Jede
Antwort mit Daten bringt mit, was ein Modell fuer die Wahl braucht:

| Feld | Inhalt |
|---|---|
| `spalten_info` | je Spalte: Rolle (`zeit` / `merkmal` / `kennzahl` / `ampel` / `schluessel`), Einheit, Zahl der verschiedenen Werte, Spanne |
| `darstellung` | „Die Form ist deine Entscheidung" — plus die Fallen dieser konkreten Daten (zwei Groessenordnungen, zu viele Kategorien, eine einzelne Zahl) |
| `zeilen` | Zahlen als Zahlen, nicht als Text |

Sagt der Nutzer „lieber als Balken", stellt das Modell die vorliegenden Daten neu dar — ohne
neue Abfrage. Die Anzeigeart, die das BI-Tool für einen Bericht führt, wird genannt — nicht vorgegeben.

## Was er nicht tut

* **Keine Diagramme.** Bewusst — siehe oben.

* **Kein Schreiben.** `manual` bleibt BI-Tool und Postico.
* **Kein Dashboard an der Wand**, keine Montags-Mail, keine Dauer-URL.
* **Keine Sicht je Betrieb** — ein OM sieht alles oder nichts. Das BI-Tool
  kann das heute auch nicht; steht in `docs/offene-punkte.md`.

---

## Der Gesundheitslauf

Jede Stunde probiert der Server **jede** Relation in `mart`/`manual`/`ampel` mit
`SELECT * … LIMIT 1` aus — als `mcp_leser`, denn nur das beweist etwas — und legt das
Ergebnis über `mcp.gesundheit_melden(jsonb)` in `mcp.sicht_gesundheit` ab. Code:
`src/gesundheit.ts`, Kosten 1,3 s für 236 Relationen (nachgemessen 21.09.2026).

**Warum das nicht in der Datenbank stehen kann:** eine Sicht kann sich nicht selbst
ausprobieren, und wer es als Eigentümer tut, bekommt grün und weiß nichts. Am 20.09.2026 hat
genau das drei Sichten kaputt in Produktion gebracht, am 21.09. elf.

Was der Lauf findet, geht ans Modell:

* `abfrage_ausfuehren` und `abfrage_pruefen` **sperren** eine Abfrage auf eine defekte Sicht,
  mit der Postgres-Meldung im Befund `sicht_defekt` — aber erst, nachdem sie die Sicht
  **selbst nachprobiert** haben: ein Messwert ist ein Anlass zu prüfen, kein Urteil.
  Gesperrt wird nur, was jetzt nicht läuft. Der Grund steht in `docs/fehlerkatalog.md`
  (21.09.2026, abends): nach dem ersten Deploy sperrte der Prüfer eine Stunde lang auf
  einem Messwert von vor der Migration. Und nur, wenn die Messung jünger als sechs Stunden
  ist — sonst bleibt es eine Warnung.
* `sichten_suchen` liefert eine defekte Sicht **weiter mit**, gekennzeichnet. Sie
  wegzulassen wäre bequemer und schlechter — das Modell suchte weiter und wiche auf eine
  Sicht mit anderer Körnung aus.
* Eine Probe **ohne Urteil** — Zeitüberlauf nach fünf Sekunden, oder ein Fehler ohne
  SQLSTATE — ist kein Defekt und sperrt nichts. Sie steht in `mart.sicht_unklar`, wird in
  `sichten_suchen` als `langsam` markiert und im Prüfer zur **Warnung** `sicht_unklar`: ohne
  engen Zeitraum läuft so eine Sicht in die 20-Sekunden-Grenze.

Nachsehen kann man es in `mart.sicht_defekt` (Erwartung: leer) und in
`mart.pruefung_uebersicht`. Dort steht auch eine Zeile, die anschlägt, wenn die
Momentaufnahme älter als 24 Stunden ist — **ohne die sähe ein stehengebliebener Lauf aus wie
eine gesunde Schicht**, weil `mart.sicht_defekt` dann leer ist.

## Fehler kommen als Fehler an

Bis zum 21.09.2026 antwortete `abfrage_ausfuehren` auf **jeden** Fehler mit
`current transaction is aborted` (SQLSTATE `25P02`) — ein Tippfehler in einem Spaltennamen
war von einer defekten Sicht nicht zu unterscheiden. Ursache war ein verschlucktes `EXPLAIN`
in `src/ausfuehren.ts`; Hergang in `docs/fehlerkatalog.md`.

Jetzt trägt die Antwort SQLSTATE, Meldung, `detail`, `hint` und `where` (`src/pg_fehler.ts`),
dazu eine Deutung je Fehlerklasse — dass `42501` ein Rechteproblem ist und Umformulieren
nicht hilft, steht in keiner Postgres-Meldung. Und sie kommt als **gewöhnliche Antwort**,
nicht als Werkzeugfehler: aus einer Ausnahme macht Skybridge `isError`, und Claude zeigt
dazu „Failed to load this connector".
