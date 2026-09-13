# Der MCP-Server — EIGENES Image, eigener Container.
#
# Warum nicht im Importer-Image: der Importer ist ein Batch, der nachts
# laeuft und dessen Container bewusst oben bleibt und nichts tut
# (src/health.ts). Dieser hier hat Publikumsverkehr, einen anderen
# Lastverlauf und ein anderes Risikoprofil — er ist der erste Dienst dieses
# Projekts, der von aussen erreichbar ist. Dokploy trennt sie sauber, genau
# wie Metabase (docs/architektur.md).
#
# BAUEN VOM WURZELVERZEICHNIS AUS, nicht aus mcp/:
#
#   docker build -f mcp/Dockerfile .
#
# Der Grund ist der Kern der Metabase-Abloesung: die 285 Kartendefinitionen
# liegen in metabase/ und werden von BEIDEN Abnehmern gelesen — von
# uebernehmen.ts fuer Metabase und von diesem Server fuer den Chat
# (docs/plan-skybridge.md, Abschnitt 2). Sie muessen also mit ins Image.

FROM oven/bun:1.2.19-alpine AS bau

RUN apk add --no-cache nodejs
WORKDIR /app

# Telemetrie aus, schon im Bau. Das Skybridge-CLI meldet Nutzungsdaten an
# PostHog; ein Dienst, der die Zahlen eines Unternehmens ausliefert, hat
# keinen Anlass, nebenbei nach draussen zu funken — und in einer Umgebung
# mit enger Egress-Regel scheitert der Bau sonst daran.
ENV SKYBRIDGE_TELEMETRY_DISABLED=1
ENV DO_NOT_TRACK=1

# Hier BEWUSST ohne --production: der Ansichtenbau braucht vite und das
# Skybridge-Plugin, und die stehen unter devDependencies. Ins Laufzeitimage
# wandert davon nichts (siehe zweite Stufe).
COPY mcp/package.json mcp/bun.lock* ./mcp/
RUN cd mcp && bun install --frozen-lockfile

COPY mcp ./mcp
COPY metabase ./metabase

# `vite` liegt in node_modules/.bin; das Skybridge-CLI ruft es ueber die
# Shell auf und fand es ohne diesen PATH nicht ("vite: not found").
# Gebaut werden nur die ANSICHTEN (vite). Der Server selbst laeuft
# unmittelbar aus TypeScript — bun kann das, und `tsc -b` koennte die
# Kartendefinitionen aus ../metabase gar nicht mitnehmen (Begruendung in
# mcp/start.ts).
#
# `vite` liegt in node_modules/.bin; ohne diesen PATH findet der Aufruf es
# nicht ("vite: not found").
RUN cd mcp && PATH="/app/mcp/node_modules/.bin:$PATH" bun run build

# --- Laufzeit --------------------------------------------------------
FROM oven/bun:1.2.19-alpine

RUN apk add --no-cache tzdata ca-certificates
ENV TZ=UTC
ENV NODE_ENV=production
ENV SKYBRIDGE_TELEMETRY_DISABLED=1
ENV DO_NOT_TRACK=1

WORKDIR /app

COPY mcp/package.json mcp/bun.lock* ./mcp/
RUN cd mcp && bun install --frozen-lockfile --production

# Aus der Baustufe nur die gebauten Ansichten; der Quelltext kommt frisch,
# damit im Laufzeitimage nichts Halbgebautes liegt.
COPY --from=bau /app/mcp/dist ./mcp/dist
COPY mcp/src ./mcp/src
COPY mcp/start.ts ./mcp/
COPY metabase ./metabase

RUN chmod -R a+rX ./mcp ./metabase

USER bun

# Skybridge liest den Port aus __PORT, nicht aus PORT. Ohne das lauscht der
# Container auf 3000, waehrend Dokploy woanders anklopft — und der
# Health-Check bleibt rot, ohne dass im Log etwas steht.
ENV __PORT=3000
EXPOSE 3000
CMD ["bun", "run", "mcp/start.ts"]
