// =====================================================================
// Beziehungen zwischen den mart-Sichten.
//
// DAS PROBLEM. Metabases eigentliche Staerke ist das Entlanghangeln:
// von einer Zahl zum Betrieb springen, von dort weiter, ohne eine Zeile
// SQL. Das bietet es aber nur an, wo es eine BEZIEHUNG kennt -- und die
// liest es aus dem Katalog als Fremdschluessel.
//
// mart besteht zu 100 % aus Sichten (50 Views, 0 Tabellen), und Postgres
// kennt keine Fremdschluessel auf Sichten. Alle 40 FKs der Datenbank
// liegen in core und manual. In mart standen deshalb 34 Schluesselfelder
// OHNE jeden semantischen Typ -- kein PK, kein FK, nichts. Die Sprunge,
// die Metabase anbot, gingen ausschliesslich innerhalb von core.
//
// Damit stand die Wahl zwischen zwei Wegen: core sichtbar machen, wo die
// Verdrahtung schon liegt -- oder mart nachverdrahten. core sichtbar zu
// machen hiesse, die stillen Fallen freizugeben, die mart gerade
// ausraeumt (docs/metabase-sichtbarkeit.md): core.umsatzbericht_tag
// fuehrt Gesamt- UND Hauptspartenzeilen in derselben Tabelle, eine Summe
// darueber ergibt den doppelten Umsatz -- ohne Fehlermeldung, mit zwei
// Nachkommastellen. Deshalb dieser Weg.
//
// DIE LOESUNG. Metabase nimmt FK-Metadaten auch dort an, wo die Datenbank
// keinen Constraint hat -- die API unterscheidet nicht zwischen Tabelle
// und Sicht. Nachgeprueft: nach dem Setzen liefert ein Breakout ueber den
// FK-Sprung Betriebsnamen statt Schluesselzahlen.
//
// DREI EBENEN, alle drei noetig:
//
//   1. Das ZIEL als Entity Key      mart.betrieb.betrieb_key -> type/PK
//   2. Die QUELLE als Foreign Key   mart.umsatz_tag.betrieb_key -> type/FK
//   3. Die ANZEIGE umhaengen        Schluessel 3 -> "Alte Post Aachen"
//
// Ohne 3. funktioniert der Sprung, aber die Spalte heisst "Betrieb Key →
// Betrieb Key" und zeigt Zahlen. Erst die Anzeigeverknuepfung macht ihn
// benutzbar.
//
// WAS BEWUSST NICHT VERDRAHTET WIRD. Ein FK braucht ein Ziel. Verdrahtet
// werden nur Achsen, zu denen es eine Dimensionssicht in mart gibt:
// betrieb_key (30 Sichten) und aktion_key (3). Nicht verdrahtet:
// artikel_key, bestellung_key und bestellposition_key -- sie kommen je
// genau einmal vor, und mart.artikel bzw. mart.bestellung gibt es nicht.
// Ein FK dorthin waere ein Sprung ins Leere. Wenn diese Sichten gebraucht
// werden, ist das eine Migration, keine Metadatenfrage.
//
// Ausgefuehrt wird das ohne Browser -- ueber den Importer-Zugang aus
// METABASE_USER/_PASSWORD, dasselbe Muster wie in uebernehmen.ts.
//
//   bun run metabase/beziehungen.ts           zeigt nur an
//   bun run metabase/beziehungen.ts --setzen  schreibt
//
// Ein zweiter Lauf aendert nichts, was schon stimmt. NACH JEDER MIGRATION,
// DIE EINE mart-SICHT ERGAENZT, einmal laufen lassen -- neue Sichten
// kommen ohne semantische Typen aus dem Katalog.
// =====================================================================

import { config } from '../src/config'

const METABASE = config.METABASE_URL ?? 'http://localhost:3000'
const DB_ID = 2

/**
 * Die Achsen, entlang derer gesprungen wird.
 *
 * `ziel` ist die Dimensionssicht, `name` die Spalte, die einen Eintrag
 * fuer einen Menschen lesbar macht. Der Schluessel heisst in Quelle und
 * Ziel gleich -- das ist die Konvention im ganzen Schema und zugleich
 * das Erkennungsmerkmal.
 */
const ACHSEN = [
  { schluessel: 'betrieb_key', ziel: 'betrieb', name: 'betrieb' },
  { schluessel: 'aktion_key', ziel: 'aktion', name: 'aktion' },
] as const

/** Sichten, die selbst Dimension sind -- dort ist der Schluessel PK, nicht FK. */
const ZIELE = new Set<string>(ACHSEN.map(a => a.ziel))

const setzen = process.argv.includes('--setzen')

// ---------------------------------------------------------------------

const anmeldung = await fetch(`${METABASE}/api/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: config.METABASE_USER, password: config.METABASE_PASSWORD }),
})
if (!anmeldung.ok) {
  console.error(`Anmeldung an Metabase gescheitert (${anmeldung.status})`)
  console.error(`  ${(await anmeldung.text()).slice(0, 300)}`)
  console.error('  METABASE_USER und METABASE_PASSWORD gesetzt?')
  process.exit(1)
}
const { id: sitzung } = await anmeldung.json() as { id: string }

const mb = async (pfad: string, methode = 'GET', koerper?: unknown) => {
  const r = await fetch(METABASE + '/api' + pfad, {
    method: methode,
    headers: { 'Content-Type': 'application/json', 'X-Metabase-Session': sitzung },
    body: koerper ? JSON.stringify(koerper) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${methode} ${pfad} → ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

type Feld = {
  id: number
  name: string
  semantic_type: string | null
  fk_target_field_id: number | null
  dimensions?: unknown[]
}
type Tabelle = { id: number; name: string; schema: string; fields: Feld[] }

const katalog = await mb(`/database/${DB_ID}/metadata?include_hidden=true`)
const martSichten: Tabelle[] = (katalog.tables ?? []).filter((t: Tabelle) => t.schema === 'mart')

console.log(`${martSichten.length} mart-Sichten im Katalog`)
console.log(setzen ? 'Modus: SETZEN\n' : 'Modus: nur anzeigen (--setzen zum Schreiben)\n')

let geaendert = 0, schonRichtig = 0, fehler = 0
const fehlendeZiele: string[] = []

for (const achse of ACHSEN) {
  const zielSicht = martSichten.find(t => t.name === achse.ziel)
  if (!zielSicht) {
    console.log(`⚠ mart.${achse.ziel} fehlt im Katalog — ${achse.schluessel} wird übersprungen`)
    fehlendeZiele.push(achse.ziel)
    continue
  }

  const zielSchluessel = zielSicht.fields.find(f => f.name === achse.schluessel)
  const zielName = zielSicht.fields.find(f => f.name === achse.name)
  if (!zielSchluessel) {
    console.log(`⚠ mart.${achse.ziel}.${achse.schluessel} fehlt — übersprungen`)
    fehlendeZiele.push(`${achse.ziel}.${achse.schluessel}`)
    continue
  }

  console.log(`── ${achse.schluessel} → mart.${achse.ziel}`)

  /** Ein Feld auf einen Zielzustand bringen; meldet, ob etwas geschrieben wurde. */
  const angleichen = async (feld: Feld, ziel: Partial<Feld>, wohin: string) => {
    const passt = Object.entries(ziel).every(([k, v]) => (feld as any)[k] === v)
    if (passt) { schonRichtig++; return }
    if (!setzen) { console.log(`   würde setzen: ${wohin}`); geaendert++; return }
    try {
      await mb(`/field/${feld.id}`, 'PUT', ziel)
      console.log(`   ✓ ${wohin}`)
      geaendert++
    } catch (e) {
      console.log(`   ✗ ${wohin} — ${(e as Error).message}`)
      fehler++
    }
  }

  // Ebene 1: das Ziel als Entity Key, sein Name als Entity Name.
  await angleichen(zielSchluessel, { semantic_type: 'type/PK' },
    `mart.${achse.ziel}.${achse.schluessel} → Entity Key`)
  if (zielName) {
    await angleichen(zielName, { semantic_type: 'type/Name' },
      `mart.${achse.ziel}.${achse.name} → Entity Name`)
  } else {
    console.log(`   ⚠ mart.${achse.ziel}.${achse.name} fehlt — Anzeige bleibt der Schlüssel`)
  }

  // Ebene 2 und 3: jede andere Sicht, die den Schluessel fuehrt.
  for (const sicht of martSichten) {
    if (ZIELE.has(sicht.name)) continue
    const quelle = sicht.fields.find(f => f.name === achse.schluessel)
    if (!quelle) continue

    await angleichen(quelle,
      { semantic_type: 'type/FK', fk_target_field_id: zielSchluessel.id },
      `mart.${sicht.name}.${achse.schluessel} → FK`)

    // Ebene 3: die Anzeige auf den Namen umhaengen. Ohne das zeigt die
    // Spalte Schluesselzahlen und heisst "Betrieb Key → Betrieb Key".
    //
    // WARUM HIER EIN ZWEITER ABRUF: /database/:id/metadata liefert das
    // Feld `dimensions` NICHT mit -- nur /field/:id tut das. Ohne diesen
    // Abruf haelt der Abgleich jede bestehende Anzeige fuer fehlend und
    // meldet bei jedem Lauf dieselben 30 Aenderungen.
    if (!zielName) continue
    const einzeln: Feld = await mb(`/field/${quelle.id}`)
    const hatAnzeige = (einzeln.dimensions ?? []).some((d: any) =>
      d.type === 'external' && d.human_readable_field_id === zielName.id)
    if (hatAnzeige) { schonRichtig++; continue }
    if (!setzen) {
      console.log(`   würde setzen: mart.${sicht.name}.${achse.schluessel} → Anzeige via Name`)
      geaendert++
      continue
    }
    try {
      await mb(`/field/${quelle.id}/dimension`, 'POST', {
        type: 'external',
        name: zielSicht.name.charAt(0).toUpperCase() + zielSicht.name.slice(1),
        human_readable_field_id: zielName.id,
      })
      console.log(`   ✓ mart.${sicht.name}.${achse.schluessel} → Anzeige via Name`)
      geaendert++
    } catch (e) {
      console.log(`   ✗ Anzeige für mart.${sicht.name}.${achse.schluessel} — ${(e as Error).message}`)
      fehler++
    }
  }
  console.log()
}

console.log('─'.repeat(60))
console.log(setzen
  ? `${geaendert} gesetzt, ${schonRichtig} schon richtig, ${fehler} Fehler`
  : `${geaendert} zu setzen, ${schonRichtig} schon richtig`)
if (fehlendeZiele.length) {
  console.log(`nicht verdrahtet (Ziel fehlt): ${fehlendeZiele.join(', ')}`)
}
if (!setzen && geaendert > 0) {
  console.log('\nZum Schreiben: bun run metabase/beziehungen.ts --setzen')
}
process.exit(fehler > 0 ? 1 : 0)
