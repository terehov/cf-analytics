# Architektur

## Betrieb

**Ein Hetzner-Server, Dokploy, Docker. Kein Kubernetes.**

Bei ~36 Mio. Zeilen im Jahr und einem kleinen Team ist Docker Compose auf einer VM die ehrlichere Antwort — weniger bewegliche Teile, und CNPG-Eigenheiten muss niemand lernen. Dokploy liefert dazu drei Dinge, die man sonst selbst bauen müsste: geplante Datenbank-Backups nach S3 (Cron-Syntax, Testfunktion), Schedule Jobs und Monitoring.

| Komponente | In Dokploy als | Warum |
|---|---|---|
| Postgres 18 | Managed Database | Backups eingebaut, Ziel **Bunny Storage S3** — anderer Anbieter, andere Ausfalldomäne |
| Importer | Application, GitHub App, Build-Typ **Dockerfile** | siehe unten |
| Metabase | Application aus Docker-Image | Phase 4 |

**Kein Docker Compose:** Postgres ist managed, Metabase ist eine eigene App. Compose würde die Backup-Oberfläche kosten und nichts bringen.

### Warum Dockerfile statt Nixpacks

Dokploy kann Nixpacks (Default), Railpack, Dockerfile, Buildpacks und Static. Trotzdem Dockerfile:

1. **Bun ist bei Nixpacks der schwache Punkt** — es läuft unter dem Node-Provider, und rund um Bun-Versionen und `bun.lock` gibt es offene Erkennungsprobleme. Railpacks Provider-Liste nennt Bun nicht.
2. **Reproduzierbarkeit.** Der Service läuft unbeaufsichtigt gegen eine undokumentierte, unversionierte API. Wenn er nachts aussteigt, muss nachvollziehbar sein, welche Bun-Version im Image war. Nixpacks entscheidet das selbst und kann die Entscheidung zwischen zwei Deploys ändern.

### Warum PostgreSQL 18 und nicht 19

18 ist seit 25.09.2025 stabil. 19 ging am 16.07.2026 in Beta 2, GA wird für September/Oktober 2026 erwartet, und das Projekt rät ausdrücklich von Beta im Produktivbetrieb ab. Diese Datenbank ist das **Archiv** — sie hält Historie, die LINA nicht mehr hergibt. Das ist der falsche Ort für Mut. 19 nach der Freigabe plus zwei, drei Minor-Releases erneut ansehen.

Was 18 konkret bringt:
- **Asynchrones I/O** greift ohne Zutun bei genau den Scans, die Metabase fährt. Auf Docker ist `io_method = worker` die sichere Wahl; `io_uring` wird von Docker-seccomp häufig blockiert.
- **Skip Scan** trägt hier, weil wir monatlich partitionieren: über die Gesamttabelle hätte `geschaeftstag` tausende Werte, pro Partitionsindex sind es ~30. Deshalb braucht `core.artikelverkauf_tag` keinen eigenen `betrieb_key`-Index.

## Datenhaltung: vanilla Postgres

**Verworfen und warum:**

| Kandidat | Grund |
|---|---|
| **StarRocks** | Produktionscluster: 3 FE + 3 BE ≈ 72 Kerne, 240 GB RAM für HA. Bei 36 Mio. Zeilen/Jahr absurd. *(LINA selbst fährt StarRocks — die bedienen damit alle Kunden auf Bon-Ebene.)* |
| **DuckDB pur** | Entweder ein Prozess mit Schreibrecht oder mehrere nur lesend. Sync-Job schreibt, während Metabase liest — geht mit dem nativen Format nicht. Das Quack-Protokoll für Multi-Writer ist Beta. |
| **pg_duckdb** | Wer damit normale Postgres-Tabellen abfragt, arbeitet weiter auf zeilenorientiertem Storage — der Spalten-Vorteil entsteht gar nicht. Dazu speicherhungrig; MotherDuck rät von der Primary ab. |
| **pg_ducklake** | Technisch reizvoll (v1.0, produktionsreif, Time Travel), aber nicht nötig. Wechselkriterium: Mart über 50 GB oder Dashboards regelmäßig über 3 Sekunden. Bei ~5 GB/Jahr Jahre entfernt. |

**Die entscheidende Zahl:** LINA gibt keine Bon-Ebene heraus, alle Endpunkte liefern Aggregate. ~100.000 Zeilen/Tag ≈ 36 Mio./Jahr, all-in ≈ 4–5 GB/Jahr. Fünf Jahre Backfill plus drei Jahre Vorlauf ≈ 40 GB. Das ist für Postgres langweilig.

## Time Travel ohne Extension

`core.kennzahlen_monat` ist append-only mit `abgerufen_am` im Primärschlüssel. Die BWA wird vom Steuerberater importiert und **rückwirkend korrigiert** — ein `UPDATE` würde die Frage „welcher Stand lag dem Round Table im Juli zugrunde?" unbeantwortbar machen. Genau dafür wird heute das Excel-Blatt `Ampelhistorie` von Hand gepflegt.

- aktueller Stand: `mart.kennzahlen_aktuell` (`DISTINCT ON`)
- historischer Stand: dieselbe Tabelle mit `abgerufen_am <= Stichtag`

## Zeit

Container und Datenbank laufen in **UTC**. `Europe/Berlin` steht an genau zwei Stellen: `core.geschaefts_zeitzone()` und `GESCHAEFTS_ZEITZONE` in `src/lib/time.ts`. Die Umgebungszeitzone ist bewusst **nicht tragend** — sonst verschiebt ein vergessenes `TZ` still die Tagesgrenze, und das fällt nicht auf, es produziert nur falsche Zahlen.

| | Beispiel | Behandlung |
|---|---|---|
| **Zeitpunkt** | `abgerufen_am`, LINAs `from`/`to` als Unix-Epoch | `timestamptz`, intern UTC |
| **Geschäftsdatum** | `geschaeftstag`, `monat`, LINAs `DD.MM.YYYY` | `date` — ein zeitzonenloses Etikett. Eine Umrechnung nach UTC wäre ein Kategorienfehler: der Wert hat keine Uhrzeit. |

Geschäftstag läuft **08:00–07:59**, belegt durch LINAs `hours`-Array `[8,9,…,23,0,…,7]`.
`core.pruefe_lina_epoch()` prüft bei jedem Lauf, ob LINA noch in Berliner Zeit rechnet, und schreibt Abweichungen nach `sync.schema_abweichung`.

## Bewusst nicht gemacht

**Kein Credential-Proxy für Endnutzer.** Die Idee, jeden Nutzer sich mit seinen LINA-Zugangsdaten anmelden zu lassen und live durchzureichen, löst zwar die Rechtefrage elegant, scheitert aber an: Credential-Handling (phishing-förmig, bricht bei 2FA/SSO), voraggregierten Endpunkten, die für Metabase-Slicing untauglich sind, fehlender Historie und session-gebundenen Betriebs-Reports (141 sequenzielle Aufrufe je Dashboard). **Hybrid stattdessen:** Schattendatenbank für Daten, LINA-Login perspektivisch nur für Authentifizierung und die Ableitung des RLS-Scopes aus `/common/api/account`.

**Kein offizieller Zugang bei Gastro-MIS.** Concept Family baut bewusst eine Parallelwelt und fragt dort nicht an. Die Integration ist per Design inoffiziell — daraus folgen zod-Validierung bei jeder Antwort, ein append-only Raw-Layer und ein bewusst unauffälliges Anfragetempo.
