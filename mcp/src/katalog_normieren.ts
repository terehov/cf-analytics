/**
 * Eine in Postico gezogene Katalog-Zelle (src/katalog_abzug.sql) in die
 * Abzugsdatei bringen — Sortierung und Form sind dieselben wie bei
 * `katalog:abzug`, deshalb ist das Ergebnis byteweise gleich.
 *
 *   bun run katalog:normieren <datei-mit-der-json-zelle>
 *   pbpaste | bun run katalog:normieren        # die Zelle direkt aus der Zwischenablage
 *
 * Gegen `katalog:abzug` auf derselben Datenbank nachgemessen am 29.10.2026:
 * identisch (cmp ohne Befund).
 */
import { rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { abzugText } from './katalog_ordnung'

const ZIEL = fileURLToPath(new URL('../test/katalog.json', import.meta.url))

const pfad = process.argv[2]
const text = pfad ? await Bun.file(pfad).text() : await Bun.stdin.text()
if (text.trim() === '') {
  console.error('Nichts zu normieren: Datei oder Eingabe ist leer. Aufruf: bun run katalog:normieren <datei> oder pbpaste | bun run katalog:normieren')
  process.exit(2)
}
let roh = JSON.parse(text)
// Postico „Als JSON kopieren" liefert [{"katalog": "<die Zelle als Zeichenkette>"}];
// die Zelle selbst (Cmd+C) kommt nackt. Beides annehmen.
if (Array.isArray(roh) && roh.length === 1) roh = roh[0]
if (roh && typeof roh === 'object' && typeof roh.katalog === 'string') roh = JSON.parse(roh.katalog)
for (const k of ['sichten', 'achsen', 'fallstricke'] as const) {
  if (!Array.isArray(roh[k])) {
    console.error(`Die Datei traegt kein Feld "${k}" — ist es die Zelle aus katalog_abzug.sql?`)
    process.exit(1)
  }
}
// Erst die Hilfsdatei, dann umbenennen: ein Fehler laesst den alten Stand stehen.
await Bun.write(ZIEL + '.neu', abzugText(roh) + '\n')
await rename(ZIEL + '.neu', ZIEL)
console.error(`geschrieben: ${ZIEL}`)
