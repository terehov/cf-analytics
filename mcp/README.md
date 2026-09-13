# Der MCP-Zugang

Die Zahlen der Concept Family AG aus **Claude, ChatGPT und GitHub Copilot**
befragen — ohne Metabase-Zugang. Plan und Begründung: [`docs/plan-skybridge.md`](../docs/plan-skybridge.md).

## Was er ist

Ein MCP-Server (Skybridge) mit zehn Werkzeugen auf der Auswertungsschicht:

| Werkzeug | Wofür |
|---|---|
| `berichte_suchen` · `bericht_ausfuehren` | Die 285 fertigen Berichte — dieselben, die die Metabase-Dashboards zeigen |
| `sichten_suchen` · `sicht_beschreiben` · `achsen_zeigen` | Der Katalog: Körnung, Spalten, Achsen, Fallstricke, Beispielabfragen |
| `betriebe_suchen` · `datenstand` | Wer ist gemeint, und was ist überhaupt beurteilbar |
| `abfrage_pruefen` · `abfrage_ausfuehren` | Freies SQL — mit Prüfung auf dem Syntaxbaum |
| `round_table` | Das Ampelraster als Ansicht |

**Zehn, nicht 285.** Jede Werkzeugbeschreibung kostet ein Modell 300–600 Token,
bevor die erste Frage gestellt ist; Cursor kappt bei 40 Werkzeugen, Copilot bei
128, Claude Desktop um 100, und die Antwortqualität sinkt messbar ab etwa 50.
Die Karten sind deshalb *ein* Werkzeug mit 285 Schlüsseln.

## Die drei Riegel

1. **Die Rolle.** `mcp_leser` sieht `mart`, `manual`, `ampel`, `mcp` — sonst
   nichts, nur lesend, mit `statement_timeout`. Ein SQL-Filter im Code wäre
   eine Liste von Umgehungen, die man nicht kennt; Postgres' Prüfung ist
   vollständig.
2. **Der Prüfer.** Jede freie Abfrage wird mit dem Parser von PostgreSQL selbst
   zerlegt und gegen `mcp.fallstrick` gehalten. Eine bekannte Falle wird
   **gesperrt**, mit Grund und meist mit der Berichtigung. Das ist die
   Verweigerung statt der selbstbewusst falschen Zahl.
3. **Der Befund-Anhang.** Jede Antwort trägt die Fallstricke der berührten
   Sichten, ihre Körnung und den Datenstand bei sich — nicht als Hoffnung,
   dass jemand den Tabellenkommentar gelesen hat.

## Einrichten

```bash
# 1. Migrationen (legen Schema mcp und die Rolle an)
bun run migrate

# 2. Einmal von Hand, als Datenbankadministrator:
#    ALTER ROLE mcp_leser LOGIN PASSWORD '...';
#    Solange das fehlt, meldet es /status und mcp.einrichtung_offen.

# 3. Umgebung (mcp/.env oder Dokploy)
MCP_DATABASE_URL=postgresql://mcp_leser:...@host/lina
MCP_OAUTH_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
MCP_OAUTH_AUDIENCE=cf-analytics-mcp

# 4. Nutzer freischalten — wer hier fehlt, kommt nicht hinein:
#    INSERT INTO mcp.nutzer_stufe (subject, anzeige, stufe)
#    VALUES ('<oauth-subject>', 'Daniel', 'lesen');

bun install && bun run start
```

## Befehle

```bash
bun test                 # 326 Tests, darunter die zehn Fallenfragen
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
MCP_DATABASE_URL=postgresql://mcp_leser:...@host/lina bun test
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

Nach jeder Migration, die eine `mart`-Sicht anlegt:

```sql
SELECT mcp.achsen_ableiten();        -- neue Sichten und Achsen nachführen
SELECT mcp.koernung_in_kommentare(); -- Körnung in die Tabellenkommentare
```

## Was er nicht tut

* **Kein Schreiben.** `manual` bleibt Metabase und Postico.
* **Kein Dashboard an der Wand**, keine Montags-Mail, keine Dauer-URL.
* **Keine Sicht je Betrieb** — ein OM sieht alles oder nichts. Metabase kann
  das heute auch nicht; steht in `docs/offene-punkte.md`.
