# Bewusst ein Dockerfile statt Nixpacks:
# Dieser Service läuft unbeaufsichtigt gegen eine undokumentierte, unversionierte
# API. Wenn er nachts aussteigt, muss nachvollziehbar sein, welche Bun-Version im
# Image war. Nixpacks entscheidet das selbst und kann die Entscheidung zwischen
# zwei Deploys ändern — Bun-Erkennung ist dort ohnehin der schwache Punkt.
FROM oven/bun:1.2.19-alpine

# Container laeuft in UTC — bewusst.
# LINA rechnet in Europe/Berlin und der Geschaeftstag laeuft 08:00–07:59, aber
# diese Regel steht explizit im Code (src/lib/time.ts) und in der Datenbank
# (core.business_date()). Die Zeitzone der Umgebung ist damit NICHT tragend:
# Niemand verschiebt versehentlich Tagesgrenzen, indem er TZ setzt oder vergisst.
# tzdata bleibt drin, weil die explizite Umrechnung die Zonendaten braucht.
RUN apk add --no-cache tzdata ca-certificates
ENV TZ=UTC

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY migrations ./migrations

# Leserechte fuer den spaeteren USER bun erzwingen, unabhaengig davon, mit
# welchen lokalen Rechten die Dateien im Build-Kontext liegen. COPY uebernimmt
# die Rechte vom Host, und ein zu restriktives umask beim Editieren (src/db,
# src/lib, src/lina, src/sync, src/transform, health.ts standen lokal auf
# 700/600, nur fuer den Owner) reichte sonst unveraendert ins Image durch --
# der Container startete dann als root, scheiterte aber an jedem COPY-Pfad,
# sobald USER bun ihn lesen wollte. Gefunden beim Testen von CMD ["bun","run",
# "start"] am 05.08.2026, siehe docs/umzug-hetzner.md.
RUN chmod -R a+rX ./src ./migrations

# Nicht als root laufen
USER bun

# Der Container bleibt oben und tut im Normalfall nichts.
# Die Läufe stößt Dokploy per Schedule Job an (docker exec `bun run sync`),
# so landet jeder Lauf als eigener Log-Eintrag in der Dokploy-Oberfläche und
# lässt sich dort auch manuell auslösen — wichtig für den Backfill.
#
# CMD migriert VOR jedem Start: src/db/migrate.ts ist idempotent (überspringt
# bereits angewendete Dateien anhand von public.schema_migration) und bricht
# mit Exit 1 ab, wenn eine Migration fehlschlägt — dann startet health.ts gar
# nicht erst, statt unbemerkt gegen ein halb migriertes Schema zu laufen.
# Ohne diesen Schritt blieb ein Deployment mit neuen Migrationen auf dem alten
# Schema stehen, bis jemand von Hand `bun run migrate` ausführte (gemessen
# 05.08.2026, siehe docs/umzug-hetzner.md).
EXPOSE 3000
CMD ["bun", "run", "start"]
