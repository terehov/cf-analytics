/**
 * Der Produktionsstart.
 *
 * WARUM EIN EIGENER EINSTIEG UND NICHT `skybridge start`.
 * Das Skybridge-CLI baut den Server mit `tsc -b` nach `dist/` und startet
 * dann `dist/__entry.js`. Dieser Server liest aber die 285
 * Kartendefinitionen aus `../metabase` — also von AUSSERHALB seines
 * `rootDir`. `tsc -b` lehnt das ab ("is not under rootDir"), und ein
 * `rootDir` ueber beide Verzeichnisse legt die Ausgabe dorthin, wo der
 * erzeugte Einstieg sie nicht sucht.
 *
 * Dieses Verzeichnis mitzunehmen ist aber kein Schoenheitsfehler, sondern
 * der Kern der Metabase-Abloesung: eine Karte, zwei Abnehmer
 * (docs/plan-skybridge.md, Abschnitt 2). Die Karten in `mcp/` zu kopieren
 * waere die zweite Wahrheit, die genau dieser Plan vermeiden will.
 *
 * Also andersherum: bun fuehrt TypeScript ohnehin unmittelbar aus, der
 * tsc-Durchlauf braeuchte hier niemand. Gebaut werden muessen nur die
 * ANSICHTEN (vite), und was `dist/__entry.js` sonst tut — das Bau-Manifest
 * setzen, damit der Server die gebauten Ansichten findet — steht hier in
 * vier Zeilen.
 *
 * Geprueft wird der Code weiterhin vollstaendig: `bun run typecheck`.
 */
import { __setBuildManifest, __setSkillsManifest } from 'skybridge/server'
import manifest from './dist/assets/.vite/manifest.json'
import { app } from './src/server'

__setBuildManifest(manifest as Parameters<typeof __setBuildManifest>[0])
__setSkillsManifest([])

await app.run()
