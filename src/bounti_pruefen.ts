/**
 * Zeigt, was ein Bounti-Token sieht — bevor der Nachtlauf es benutzt.
 *
 *     bun run bounti:pruefen
 *
 * Liest nur. Kein Schreibzugriff, keine Aenderung an der Datenbank, keine
 * Datenbankverbindung ueberhaupt.
 *
 * WOZU DAS DA IST. Diese Anbindung ist gegen die OpenAPI-Spezifikation
 * gebaut worden; der erste Lauf gegen die echte Schnittstelle war am
 * 24.08.2026, und seine Messwerte stehen in docs/bounti-api-inventar.md §8.
 *
 * Das Skript bleibt, weil dieselben fuenf Annahmen jederzeit wieder kippen
 * koennen — eine Schnittstelle aendert sich, ohne dass jemand Bescheid
 * sagt. Sie tragen die ganze Anbindung:
 *
 *   1. Traegt jede Liste die Huelle {next, rows}?
 *   2. Nimmt Bounti limit=100, oder faellt der Client auf 20 zurueck?
 *   3. Sind Rollen ueberhaupt gepflegt? Der BEREICH (Kueche, Service, Bar)
 *      ist der wichtigste Punkt der ganzen Anforderung — welchem Bereich
 *      ein Mensch zugeordnet ist, weiss sonst kein System.
 *   4. Steht in customFields eine Personalnummer? Sie waere die Bruecke,
 *      an der Kapitel 4.2 der Round-Table-Map heute scheitert. Ausgegeben
 *      werden NUR die Feldnamen, nie die Werte.
 *   5. Ist assessmentScore ein Bruch (0.8) oder eine Prozentzahl (80)?
 *      Bountis Doku sagt Bruch. Eine Verwechslung waere eine Quote, die um
 *      den Faktor 100 danebenliegt und trotzdem plausibel aussieht.
 *
 * Kostet rund ein Dutzend Aufrufe von 3.000 je Stunde.
 */
import { config } from './config'
import {
  bountiKonfiguriert, bountiZaehler,
  standorteHolen, rollenHolen, mitarbeiterHolen, kurseHolen, pfadeHolen,
  kurszuweisungenHolen, fortschrittHolen, auditsHolen, auditberichteHolen,
} from './bounti/client'

if (!bountiKonfiguriert()) {
  console.error(
    'BOUNTI_API_TOKEN ist nicht gesetzt.\n\n' +
    'Das Token gehoert in die .env (NICHT in .env.example, die wird committet):\n' +
    "  BOUNTI_API_TOKEN='...'\n\n" +
    'Der Abschnitt "Bounti" in .env.example nennt die uebrigen, optionalen Zeilen.')
  process.exit(1)
}

console.log(`Bounti-Zugang pruefen\n  Instanz      ${config.BOUNTI_BASE_URL}\n` +
  `  Tokenlaenge  ${config.BOUNTI_API_TOKEN!.length}\n` +
  `  Seite        ${config.BOUNTI_SEITE}\n`)

function fehler(was: string, e: unknown): never {
  console.error(`\n${was} fehlgeschlagen: ${String((e as Error).message ?? e)}\n\n` +
    'Bei 403 INVALID_API_KEY: Token pruefen — und daran denken, dass Bun ein\n' +
    'unquotiertes Token mit $ oder # still kuerzt. Die Laenge oben muss zum\n' +
    'hinterlegten Wert passen.')
  process.exit(1)
}

// --- 1. Standorte ---------------------------------------------------------
let standorte
try { standorte = await standorteHolen() } catch (e) { fehler('Standorte holen', e) }
console.log(`STANDORTE  ${standorte.length}`)
for (const s of standorte.slice(0, 15)) console.log(`  ${s.id.padEnd(28)} ${s.name}`)
if (standorte.length > 15) console.log(`  ... und ${standorte.length - 15} weitere`)

// --- 2. Rollen = der Bereich ----------------------------------------------
let rollen
try { rollen = await rollenHolen() } catch (e) { fehler('Rollen holen', e) }
console.log(`\nROLLEN  ${rollen.length}   (der "Bereich" der Anforderung — Kueche, Service, Bar?)`)
for (const r of rollen) console.log(`  ${r.id.padEnd(28)} ${r.name}`)
if (rollen.length === 0) {
  console.log('  KEINE ROLLEN GEPFLEGT. Damit ist die Auswertung je Bereich nicht')
  console.log('  moeglich — und das war laut docs/datenlage-round-table der wichtigste')
  console.log('  Punkt an Bounti. Gehoert dem Fachbereich gemeldet, nicht dem Code.')
}

// --- 3. Mitarbeitende, beide Listen ---------------------------------------
let aktiv, archiviert
try {
  aktiv = await mitarbeiterHolen(false)
  archiviert = await mitarbeiterHolen(true)
} catch (e) { fehler('Mitarbeitende holen', e) }

const ohneStandort = aktiv.filter(m => (m.locations ?? []).length === 0).length
const mehrfach = aktiv.filter(m => (m.locations ?? []).length > 1).length
const ohneRolle = aktiv.filter(m => (m.roles ?? []).length === 0).length
console.log(`\nMITARBEITENDE  ${aktiv.length} aktiv, ${archiviert.length} archiviert`)
console.log(`  ohne Standort   ${ohneStandort}  (zaehlen in KEINEM Betrieb mit)`)
console.log(`  an mehreren     ${mehrfach}  (zaehlen in JEDEM ihrer Betriebe mit)`)
console.log(`  ohne Rolle      ${ohneRolle}  (fehlen in jeder Auswertung je Bereich)`)

// --- 4. customFields: nur die Namen ---------------------------------------
const felder = new Map<string, number>()
for (const m of [...aktiv, ...archiviert]) {
  for (const [k, v] of Object.entries(m.customFields ?? {})) {
    const da = v !== null && v !== undefined && String(v).trim() !== ''
    felder.set(k, (felder.get(k) ?? 0) + (da ? 1 : 0))
  }
}
console.log(`\nCUSTOMFIELDS  ${felder.size} Feld(er) konfiguriert — nur Namen, keine Werte:`)
for (const [k, n] of [...felder].sort()) {
  console.log(`  ${k.padEnd(28)} bei ${n} von ${aktiv.length + archiviert.length} belegt`)
}
if (felder.size === 0) {
  console.log('  keine. Damit gibt es keinen Schluessel, der Bounti mit LINA verbindet —')
  console.log('  Kapitel 4.2 (Kurswirkung je Person) bleibt ohne die gesperrten')
  console.log('  LINA-Mitarbeiterstammdaten unerreichbar.')
}

// --- 5. Lernkatalog und die Skalenfrage -----------------------------------
let kurse, pfade
try { kurse = await kurseHolen(); pfade = await pfadeHolen() } catch (e) { fehler('Lernkatalog holen', e) }
console.log(`\nLERNKATALOG  ${kurse.length} Kurse, ${pfade.length} Pfade`)
console.log(`  Rotation: ${config.BOUNTI_LERNEINHEITEN_JE_LAUF} je Nacht  ->  ` +
  `${Math.ceil((kurse.length + pfade.length) / Math.max(1, config.BOUNTI_LERNEINHEITEN_JE_LAUF))} ` +
  `Naechte fuer den ersten vollstaendigen Bestand`)

if (kurse[0]) {
  let z
  try { z = await kurszuweisungenHolen(kurse[0].id) } catch (e) { fehler('Zuweisungen holen', e) }
  const noten = z.map(x => x.assessmentScore).filter((x): x is number => typeof x === 'number')
  console.log(`\nSTICHPROBE  Kurs "${kurse[0].name}": ${z.length} Zuweisungen, ` +
    `${z.filter(x => x.completedAt).length} abgeschlossen, ` +
    `${z.filter(x => x.dueAt).length} mit Frist`)
  if (noten.length) {
    const max = Math.max(...noten)
    console.log(`  assessmentScore  ${noten.length} Werte, groesster ${max}  ->  ` +
      (max <= 1 ? 'BRUCH, wie dokumentiert (wird mit 100 multipliziert)'
                : 'PROZENTZAHL — Skala gewechselt! docs/bounti-api-inventar.md pruefen'))
  } else {
    console.log('  assessmentScore  keine Werte in dieser Stichprobe')
  }
  if (z.filter(x => x.dueAt).length === 0 && z.length > 0) {
    console.log('  KEINE FRISTEN. "Ueberfaellig" ist damit nicht berechenbar, und')
    console.log('  Pflichtschulungen sind von freiwilligen nicht unterscheidbar.')
  }
}

// --- 6. Fortschritt und Audits --------------------------------------------
try {
  const f = await fortschrittHolen()
  console.log(`\nFORTSCHRITT  ${f.length} Standorte (ein Aufruf fuer alle)`)
  for (const z of f.slice(0, 10)) {
    console.log(`  ${z.name.padEnd(32)} ${z.courses?.completed ?? 0} von ${z.courses?.total ?? 0}`)
  }
} catch (e) {
  console.log(`\nFORTSCHRITT  nicht abrufbar: ${String((e as Error).message ?? e).slice(0, 140)}`)
}

try {
  const a = await auditsHolen()
  const orte = a.filter(x => x.type === 'LOCATION_AUDIT')
  console.log(`\nAUDITS  ${a.length} gesamt, davon ${orte.length} auf Standortebene`)
  for (const x of a.slice(0, 10)) console.log(`  ${x.type.padEnd(15)} ${x.name}`)
  const b = await auditberichteHolen()
  const fertig = b.filter(x => x.completedAt)
  console.log(`  Berichte: ${b.length}, davon ${fertig.length} abgeschlossen` +
    (fertig.length ? `, Schnitt ${(fertig.reduce((s, x) => s + (x.achievedPercentage ?? 0), 0) / fertig.length).toFixed(1)} %` : ''))
} catch (e) {
  console.log(`\nAUDITS  nicht abrufbar: ${String((e as Error).message ?? e).slice(0, 140)}`)
}

const z = bountiZaehler()
console.log(`\n${z.aufrufe} Aufrufe verbraucht` +
  (z.rest === null ? '' : `, Bounti meldet ${z.rest} von 3.000 uebrig in dieser Stunde`))
console.log('Nichts geschrieben. Die Zuordnung Standort -> Betrieb: bun run bounti:zuordnen')
