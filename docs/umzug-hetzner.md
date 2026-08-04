# Umzug nach Hetzner: lina-DB, Metabase, Sync

Ziel: Postgres von `localhost` auf die Dokploy-Instanz, Metabase von localhost:3000
auf Cloudron, Backfill und Sync als Dokploy-Jobs.

Ausgangslage bei Planerstellung (04.08.2026):

- lina-DB 9,3 GB, Postgres 18.4 (Postgres.app), Extensions `pg_trgm`, `plpgsql`
- Schemas: `ampel core manual mart part public raw sync`
- Migrationsstand: `0045_mart_inventur_und_beleg.sql`
- Laufender Backfill: Lauf 71, 815 offene `fn:bestellungen`-Posten — wird gestoppt
- Metabase-Dashboards liegen als Code im Repo, werden neu provisioniert

Entscheidungen: Backfill jetzt stoppen · kompletter Dump inkl. `raw.api_antwort` ·
DB-Port öffentlich erreichbar · Metabase frisch aus dem Repo.

---

## Schritt 0 — Vorbedingungen prüfen ✅ erledigt (04.08.2026)

Geprüft und in Ordnung:

| Prüfung | Ergebnis |
| --- | --- |
| Quelle | PostgreSQL 18.4 (Postgres.app) |
| Ziel | PostgreSQL 18.4 (Debian pgdg13) — **identisch** |
| lokale Clients | `pg_dump` / `psql` 18.4 |
| Zielbank | leer: nur `public`, 0 Tabellen |
| Benutzer `cf` | Superuser → darf Extensions anlegen |
| Zeitzone Ziel | `Etc/UTC` — passt zum Dockerfile-Konzept |
| Latenz | ~192 ms Roundtrip |
| Upload | ~1,5 MB/s |

Die Verbindung steht als Shell-Variable, damit die Zugangsdaten nicht in jeder
Zeile stehen:

```bash
export ZIEL="postgresql://cf:PASSWORT@178.104.197.120:55432/analytics?connect_timeout=20"
```

> **Die Zieldatenbank heißt `analytics`, die Quelle `lina`.** Das ist unkritisch —
> ein Dump enthält keine Datenbanknamen, die Schemas landen einfach in
> `analytics`. Aber die `DATABASE_URL` endet künftig auf `/analytics`.
>
> ⚠️ **Die Verbindung ist unverschlüsselt.** `pg_stat_ssl` meldet `ssl = f`, und
> `sslmode=disable` wird ebenfalls angenommen — der Server erzwingt TLS nicht.
> Für den einmaligen Umzug mit anschließender Passwortrotation vertretbar, für
> den Dauerbetrieb nicht: siehe Schritt 7.

---

## Schritt 1 — Backfill sauber stoppen

Der Worker fängt SIGTERM/SIGINT ab und schließt den Lauf geordnet ab
(`src/sync/worker.ts:393`). Also **kein** `kill -9` — sonst bleibt der Lauf auf
`laeuft` stehen und die angefassten Posten behalten `in_arbeit_seit`.

```bash
pgrep -fl "bun run src/sync.ts"
kill <PID>          # einmal. Ein zweites Signal erzwingt sofortigen Abbruch.
```

Warten, bis der Prozess weg ist, dann bestätigen:

```bash
psql "postgresql://postgres@localhost/lina" -c \
  "select lauf_id, status, beendet_am, aufgaben_ok, aufgaben_fehler
     from sync.lauf order by lauf_id desc limit 3"
```

Der oberste Lauf muss `abgebrochen` (oder `ok`/`teilweise`) sein, `beendet_am`
gesetzt. Steht dort noch `laeuft`, hat der Prozess das Signal nicht verarbeitet —
dann von Hand nachziehen, sonst hält die Einmal-Sperre den nächsten Lauf ab:

```sql
UPDATE sync.lauf SET status = 'abgebrochen', beendet_am = now(),
       notiz = 'vor Umzug nach Hetzner beendet'
 WHERE status = 'laeuft';
```

Hängende Posten freigeben, damit sie auf Hetzner wieder gezogen werden:

```sql
UPDATE sync.warteschlange SET in_arbeit_seit = NULL
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NOT NULL;
```

Die 815 offenen `fn:bestellungen` bleiben in der Warteschlange und wandern mit dem
Dump. Der erste Lauf auf Hetzner macht dort weiter — das ist der Sinn davon, dass
der Zustand in der Datenbank liegt und nicht im Prozess.

> **FoodNotify-Tagesbudget:** angefangene Posten kosten erneut Kontingent.
> `FN_TAGESBUDGET` steht lokal auf einem hohen Wert; beim Serverbetrieb den
> gewünschten Wert bewusst setzen (siehe Schritt 5).

---

## Schritt 2 — Dump ziehen

Ab hier schreibt niemand mehr in die lokale DB.

```bash
mkdir -p ~/umzug && cd ~/umzug

pg_dump "postgresql://postgres@localhost/lina" \
  --format=directory \
  --jobs=4 \
  --compress=1 \
  --no-owner --no-privileges \
  --verbose \
  --file=lina-dump
```

Warum diese Optionen:

- `--format=directory` + `--jobs=4` — parallel, und `pg_restore` kann später
  ebenfalls parallel einspielen. Bei 192 ms Latenz zum Server ist das der
  wichtigste Hebel: ein einzelner Strom wartet die meiste Zeit.
- `--compress=1` — **gemessen, nicht geraten.** Auf diesen Daten:

  | Stufe | Datenmenge | Ergebnis | Dauer |
  | --- | --- | --- | --- |
  | `--compress=9` | 1691 MB | 870 MB | 796 s |
  | `--compress=1` | 1347 MB | 504 MB | 17 s |

  Stufe 1 ist rund 37× schneller *und* komprimiert hier besser. Stufe 9
  verbrennt bei JSON-Rohdaten nur CPU.
- `--no-owner --no-privileges` — der Rollenname auf Hetzner ist `cf`, nicht
  `postgres`. Ohne diese Flags scheitert der Restore an unbekannten Rollen.

**Erwartete Größen** (gemessen am 04.08.2026):

| Teil | Roh | Komprimiert |
| --- | --- | --- |
| Kernbestand (core, mart, sync, ampel, manual) | 6291 MB | **442 MB** |
| `part.api_antwort` (60 Partitionen) | 3099 MB | ~1160 MB |
| **Gesamt** | 9,3 GB | **~1,6 GB** |

Bei ~1,5 MB/s Upload also grob 20 Minuten Übertragung — nicht Stunden.
Der Kernbestand allein ist in ~5 Minuten drüben.

Größe und Vollständigkeit prüfen:

```bash
du -sh lina-dump
pg_restore --list lina-dump | wc -l
pg_restore --list lina-dump | grep -c "TABLE DATA"
```

Zum Abgleich die Quellzahlen festhalten — die brauchen wir in Schritt 4:

```bash
psql "postgresql://postgres@localhost/lina" -tAc "
  select 'migration: '||max(filename) from schema_migration
  union all select 'umsatzbericht_tag: '||count(*) from core.umsatzbericht_tag
  union all select 'bestellposition: '||count(*) from core.bestellposition
  union all select 'api_antwort: '||count(*) from raw.api_antwort
  union all select 'warteschlange offen: '||count(*) from sync.warteschlange
           where erledigt_am is null
" | tee ~/umzug/quellzahlen.txt
```

---

## Schritt 3 — Zielbank vorbereiten

Die Extensions müssen **vor** dem Restore da sein — `pg_trgm` wird von Indizes
gebraucht. (`cf` ist Superuser, der Restore könnte sie theoretisch selbst
anlegen; explizit ist es verlässlicher.)

```bash
psql "$ZIEL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
psql "$ZIEL" -c "select extname from pg_extension order by 1;"
```

Die Datenbank muss leer sein:

```bash
psql "$ZIEL" -tAc "
  select nspname from pg_namespace
   where nspname not like 'pg_%' and nspname <> 'information_schema'"
```

Erwartet: nur `public`. Stehen dort schon `core`/`sync`, wurde vorher etwas
eingespielt — dann erst klären, was, statt darüberzubügeln.

---

## Schritt 4 — Dump einspielen

```bash
cd ~/umzug
pg_restore \
  --dbname="$ZIEL" \
  --jobs=4 \
  --no-owner --no-privileges \
  --verbose \
  lina-dump 2>&1 | tee restore.log
```

Nach der Messung aus Schritt 2 rund 20 Minuten. Läuft die Verbindung über ein
instabiles Netz, den Befehl trotzdem in `tmux`/`screen` starten — ein Abbruch
mittendrin bedeutet, den betroffenen Teil neu einzuspielen.

Danach die Fehler durchsehen — nicht jeder ist schlimm:

```bash
grep -iE "error|warning" restore.log | sort | uniq -c | sort -rn | head -30
```

Unkritisch sind Meldungen zu `COMMENT ON EXTENSION`, `OWNER TO` und fehlenden
Rollen. Kritisch ist alles zu `TABLE DATA`, `CONSTRAINT` und `INDEX`.

Statistiken neu rechnen, sonst sind die ersten Dashboard-Abfragen quälend
langsam (der Restore überträgt keine Planner-Statistiken):

```bash
psql "$ZIEL" -c "ANALYZE;"
```

**Gegenprobe gegen die Quellzahlen:**

```bash
psql "$ZIEL" -tAc "
  select 'migration: '||max(filename) from schema_migration
  union all select 'umsatzbericht_tag: '||count(*) from core.umsatzbericht_tag
  union all select 'bestellposition: '||count(*) from core.bestellposition
  union all select 'api_antwort: '||count(*) from raw.api_antwort
  union all select 'warteschlange offen: '||count(*) from sync.warteschlange
           where erledigt_am is null
" > ~/umzug/zielzahlen.txt

diff ~/umzug/quellzahlen.txt ~/umzug/zielzahlen.txt && echo "IDENTISCH"
```

Zusätzlich die materialisierten Sichten prüfen — die kommen als Definition mit,
aber der Inhalt muss da sein:

```bash
psql "$ZIEL" -tAc "
  select schemaname||'.'||matviewname||' | '||
         case when ispopulated then 'gefuellt' else 'LEER' end
    from pg_matviews order by 1"
```

Steht dort `LEER` (u. a. `mart.deckungsbeitrag_warengruppe`, `mart.round_table_*`):

```bash
psql "$ZIEL" -c "REFRESH MATERIALIZED VIEW mart.deckungsbeitrag_warengruppe;"
# und je betroffener Sicht
```

> **Migrationen nicht neu abspielen.** Eine leere Datenbank scheitert an 0039
> (verweist auf eine Spalte, die erst 0041 anlegt — siehe `docs/fehlerkatalog.md`).
> Der Weg ist der Dump, nicht `bun run migrate`. Auf der Zielbank steht
> `schema_migration` durch den Restore bereits korrekt auf 0045.

---

## Schritt 5 — Importer auf Dokploy

Das `Dockerfile` ist bereits auf diesen Betrieb ausgelegt: Container bleibt über
`src/health.ts` oben, Läufe kommen per Schedule Job als `docker exec`.

### 5a — Anwendung anlegen

In Dokploy eine Anwendung aus diesem Git-Repository anlegen, Build-Typ
**Dockerfile** (nicht Nixpacks — die Begründung steht im Dockerfile-Kopf).

### 5b — Umgebungsvariablen setzen

Vollständige Liste in `.env.example`. Diese Werte ändern sich gegenüber lokal:

| Variable | Wert auf Hetzner |
|---|---|
| `DATABASE_URL` | interne Dokploy-Adresse der Postgres-DB, **nicht** der öffentliche Port |
| `METABASE_URL` | öffentliche Cloudron-URL der Metabase-Instanz |
| `TZ` | `UTC` — bewusst, siehe Dockerfile-Kopf |
| `FN_TAGESBUDGET` | bewusst setzen; lokal steht ein Testwert |
| `LOG_LEVEL` | `info` |

Aus der lokalen `.env` übernehmen (Zugangsdaten, nicht ins Repo):

```
LINA_USER LINA_PASSWORD LINA_PASSWORD_HASH LINA_SYSTEM LINA_BASE_URL
FN_BASE_URL
FN_APOSTO_USER FN_APOSTO_PASSWORD
FN_ENCHILADA_USER FN_ENCHILADA_PASSWORD
FN_WILMA_WUNDER_USER FN_WILMA_WUNDER_PASSWORD
FN_DEUTSCHE_KONZEPTE_USER FN_DEUTSCHE_KONZEPTE_PASSWORD
YEXT_API_KEY
METABASE_USER METABASE_PASSWORD
TAKT_MIN_MS TAKT_MAX_MS FN_TAKT_MIN_MS FN_TAKT_MAX_MS
TAGESBUDGET MAX_POSTEN_PRO_LAUF MAX_VERSUCHE ABBRUCH_NACH_FEHLERN
ANFRAGE_TIMEOUT_MS FENSTER_VON_STUNDE FENSTER_BIS_STUNDE PORT
```

> **SSL:** `src/db/pool.ts` setzt keine SSL-Option und reicht die
> `connectionString` durch. Der Server verlangt derzeit kein TLS (gemessen in
> Schritt 0), es geht also ohne Zusatz. Innerhalb des Dokploy-Netzes ist das
> vertretbar — über den öffentlichen Port nicht, siehe Schritt 7.

### 5c — Health prüfen

Nach dem Deploy muss der Container laufen und Auskunft geben:

```bash
curl -s https://<dokploy-host>/health | jq
```

Erwartet: `letzterLauf` mit dem abgebrochenen Lauf aus Schritt 1 und eine
`offeneWarteschlange` in der Größenordnung 830 (die Zahl wächst, solange
`nachfuellen()` läuft — sie ist kein Countdown). Zeigt es `db_nicht_erreichbar`,
stimmt die `DATABASE_URL` innerhalb des Containers nicht.

### 5d — Backfill fortsetzen

Als Dokploy Schedule Job oder einmalig von Hand:

```bash
docker exec <container> bun run src/sync.ts --backfill
```

Die 815 offenen Posten werden abgearbeitet. Läuft der erste Durchgang sauber,
den regulären Zeitplan aktivieren:

```bash
docker exec <container> bun run sync     # ausloeser = 'zeitplan'
```

`src/sync.ts` füllt die Warteschlange selbst nach (`nachfuellen()`) — es braucht
**keinen** zweiten Job für `einreihen`. Genau dessen Ausfall hat LINA im August
acht Tage stillstehen lassen, ohne dass es auffiel.

---

## Schritt 6 — Metabase auf Cloudron

### 6a — Datenbankverbindung eintragen

In der Metabase-Oberfläche unter *Admin → Databases* die Hetzner-Postgres
eintragen. Danach die vergebene ID feststellen:

```
Admin → Databases → auf den Eintrag klicken → die URL endet auf /admin/databases/<ID>
```

### 6b — DB_ID im Repo anpassen

**Das ist die Stolperstelle.** Die ID ist an drei Stellen fest verdrahtet und
steht dort auf `2`:

- `metabase/uebernehmen.ts:38`
- `metabase/beziehungen.ts:60`
- `metabase/sichtbarkeit.ts:26`

Ist die neue ID nicht 2, alle drei anpassen. Sonst legt das Provisionieren Karten
gegen eine nicht existierende Datenbank an und die Dashboards bleiben leer.

### 6c — Provisionieren

`METABASE_URL` in der lokalen `.env` auf die Cloudron-Instanz zeigen lassen, dann:

```bash
cd "/Users/eugene/Development/concept family/analytics"
bun run metabase/uebernehmen.ts
# danach http://localhost:8899/ im Browser öffnen
```

Der Umweg über den lokalen Proxy ist Absicht — Metabases CSP verbietet der
eigenen Seite Anfragen nach außen (Begründung im Kopf von `uebernehmen.ts`).
Vorher im Browser an der Cloudron-Metabase anmelden: die Sitzung kommt aus dem
Browser-Cookie.

Ein zweiter Lauf legt nichts doppelt an — jede Karte trägt ihren Schlüssel als
`[key:...]` in der Beschreibung.

### 6d — Nachlauf

```bash
bun run metabase/sichtbarkeit.ts     # Tabellen-/Spaltensichtbarkeit
bun run metabase/beziehungen.ts      # Fremdschlüssel-Beziehungen
```

Danach in der Oberfläche stichprobenartig prüfen: ein Dashboard je Bereich
öffnen, Filter setzen, einen Drilldown klicken (z. B. Umsatzstärkste Artikel →
Artikeldetail — dort ging zuletzt der `betrieb`-Filter verloren).

---

## Schritt 7 — Abschluss

- [ ] **Passwort der Postgres-DB rotieren** (die Zugangsdaten liefen im Klartext
      über die Leitung und standen in einer Chat-Sitzung)
- [ ] **Öffentlichen Postgres-Port schließen** oder per Firewall auf bekannte
      IPs beschränken. Der Importer läuft im selben Dokploy-Netz und braucht
      `178.104.197.120:55432` nicht — er soll die **interne** Adresse benutzen.
      Ohne diesen Schritt hängt eine 9-GB-Geschäftsdatenbank unverschlüsselt am
      offenen Internet.
- [ ] Lokale `.env` sichern, `DATABASE_URL` auf Hetzner umstellen oder die
      lokale DB bewusst als Kopie stehen lassen
- [ ] Erster planmäßiger Sync auf Hetzner sauber durchgelaufen
      (`sync.lauf.status = 'ok'`)
- [ ] `/health` meldet einen aktuellen Lauf
- [ ] Backup auf Dokploy einrichten — **und einen Restore testen.**
      `docs/offene-punkte.md` führt „Restore testen" bereits als offenen Punkt;
      der Umzug ist der natürliche Moment, ihn zu schließen.
- [ ] Lokale Postgres.app-Instanz erst abschalten, wenn Hetzner mehrere Tage
      stabil läuft

## Rückweg

Bis Schritt 7 abgeschlossen ist, bleibt die lokale Datenbank unverändert liegen.
Geht auf Hetzner etwas schief: `DATABASE_URL` und `METABASE_URL` lokal
zurückstellen, Dokploy-Job pausieren, weiterarbeiten wie bisher. Der Dump in
`~/umzug/lina-dump` ist der Stand zum Umzugszeitpunkt.
