/**
 * Vorschau auf den Bounti-Zuordnungsabgleich — für Menschen, im Terminal.
 *
 *     bun run bounti:zuordnen               nur anzeigen (Voreinstellung)
 *     bun run bounti:zuordnen --schreiben   übernehmen
 *
 * DIE ARBEIT SELBST STEHT IN `src/bounti/zuordnen.ts` UND LÄUFT VON SELBST —
 * einmal je Kalendermonat als Teil von `bountiNachlauf()`. Diese Datei
 * rechnet nichts eigenes: sie ruft denselben Abgleich auf und druckt ihn
 * lesbar aus. Eine zweite Kopie derselben Logik wäre die Sorte Verdopplung,
 * bei der eine Seite irgendwann still hinter der anderen zurückbleibt.
 *
 * WARUM ES IHN TROTZDEM GIBT: mehrdeutige Fälle entscheidet der Automat
 * bewusst NICHT — sie gehören in `VON_HAND`, und wer dort etwas einträgt,
 * will vor dem Schreiben sehen, was daraus folgt. Der nächtliche Lauf zeigt
 * das nicht, er schreibt.
 */
import { pool } from './db/pool'
import { zuordnungAbgleichen } from './bounti/zuordnen'
import { bountiKonfiguriert } from './bounti/client'

const SCHREIBEN = process.argv.includes('--schreiben')

if (!bountiKonfiguriert()) {
  console.error('BOUNTI_API_TOKEN ist nicht gesetzt — siehe .env.example, Abschnitt Bounti.')
  process.exit(1)
}

const b = await zuordnungAbgleichen({ schreiben: SCHREIBEN })

console.log(`${b.standorte} Standorte in Bounti, ${b.zugeordnet} zugeordnet, ${b.offen} offen\n`)

for (const t of b.treffer.sort((x, y) => x.standort.localeCompare(y.standort))) {
  const genau = t.art === 'Name identisch' || t.art === 'von Hand'
  console.log(`${genau ? '  ' : '~ '}${t.standortId.padEnd(28)} ${t.standort.padEnd(38)} -> [${String(t.betriebKey).padStart(3)}] ${t.betrieb}`)
}

if (b.mehrdeutig.length) {
  console.log(`\nMEHRDEUTIG (${b.mehrdeutig.length}) -- der Automat entscheidet das NICHT.`)
  console.log('Gehoeren nach VON_HAND in src/bounti/zuordnen.ts:')
  for (const m of b.mehrdeutig) {
    console.log(`  ${m.id.padEnd(28)} ${m.name}`)
    for (const k of m.kandidaten) console.log(`      passt auch auf: ${k}`)
  }
}

const nurOffen = b.offene_namen.filter(o => !b.mehrdeutig.some(m => m.id === o.id))
if (nurOffen.length) {
  console.log(`\nOHNE ZUORDNUNG (${nurOffen.length}) -- kein Betrieb passt auf den Namen:`)
  for (const o of nurOffen) console.log(`  ${o.id.padEnd(28)} ${o.name}`)
}

console.log(SCHREIBEN
  ? `\n${b.geschrieben} Zeilen in manual.betrieb_fremd_id geschrieben.`
  : '\nNichts geschrieben. Mit --schreiben uebernehmen — oder abwarten: der '
    + 'naechtliche Lauf macht es einmal im Monat von selbst.')

await pool.end()
