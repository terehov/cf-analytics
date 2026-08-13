/**
 * Vorschau auf den Yext-Zuordnungsabgleich — für Menschen, im Terminal.
 *
 *     bun run yext:zuordnen               nur anzeigen (Voreinstellung)
 *     bun run yext:zuordnen --schreiben   übernehmen
 *
 * DIE ARBEIT SELBST STEHT IN `src/yext/zuordnen.ts` UND LÄUFT VON SELBST —
 * einmal je Kalendermonat als Teil von `yextNachlauf()` (seit 14.08.2026).
 * Diese Datei rechnet nichts eigenes: sie ruft denselben Abgleich auf und
 * druckt ihn lesbar aus. Eine zweite Kopie derselben Logik wäre die Sorte
 * Verdopplung, bei der eine Seite irgendwann still hinter der anderen
 * zurückbleibt.
 *
 * WARUM ES ÜBERHAUPT NOCH GIBT: der Abgleich ordnet über Namen zu, und wer
 * eine neue Entität in `VON_HAND` einträgt, will vor dem Schreiben sehen, was
 * daraus folgt. Der nächtliche Lauf zeigt das nicht — er schreibt.
 */
import { pool } from './db/pool'
import { zuordnungAbgleichen } from './yext/zuordnen'
import { yextKonfiguriert } from './yext/client'

const SCHREIBEN = process.argv.includes('--schreiben')

if (!yextKonfiguriert()) {
  console.error('YEXT_API_KEY ist nicht gesetzt — siehe .env.example, Abschnitt Yext.')
  process.exit(1)
}

const b = await zuordnungAbgleichen({ schreiben: SCHREIBEN })

console.log(`${b.entitaeten_im_konto} Entitaeten im Konto, ${b.entitaeten_unsere} in unseren Ordnern ` +
  `(${b.entitaeten_im_konto - b.entitaeten_unsere} uebrige: fremde Kunden, Markensaetze, Zentrale)\n`)

const norm = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
for (const t of b.treffer.sort((x, y) => x.entitaetsId.localeCompare(y.entitaetsId))) {
  const genau = norm(t.yext) === norm(t.betrieb)
  console.log(`${genau ? '  ' : '~ '}${t.entitaetsId.padEnd(7)} ${t.yext.padEnd(38)} -> [${String(t.betriebKey).padStart(3)}] ${t.betrieb}`)
}

if (b.offene_namen.length) {
  console.log(`\nOHNE ZUORDNUNG (${b.offene_namen.length}) -- gehoeren nach VON_HAND in src/yext/zuordnen.ts:`)
  for (const e of b.offene_namen) console.log(`  ${e.id.padEnd(7)} ${e.name.padEnd(38)} ${e.ort}`)
}

const ohneGeo = b.treffer.filter(t => !b.mitGeo.includes(t))
if (ohneGeo.length) {
  console.log(`\nOHNE KOORDINATEN (${ohneGeo.length}):`)
  for (const t of ohneGeo) console.log(`  ${t.entitaetsId.padEnd(7)} ${t.yext}`)
}

console.log(`\n${b.entitaeten_unsere} Entitaeten in unseren Ordnern, ${b.zugeordnet} zugeordnet, ` +
  `${b.offen} offen, ${b.mit_koordinaten} mit Koordinaten`)

console.log(SCHREIBEN
  ? `\n${b.geschrieben} Zeilen in manual.betrieb_fremd_id geschrieben.`
  : '\nNichts geschrieben. Mit --schreiben uebernehmen — oder abwarten: der '
    + 'naechtliche Lauf macht es einmal im Monat von selbst.')

await pool.end()
