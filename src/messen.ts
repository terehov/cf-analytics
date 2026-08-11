/**
 * Einmalige LESENDE Messaufrufe — sechs Fragen, sechs Antworten.
 *
 * WARUM ES DIESE DATEI GIBT. Am 11.08.2026 standen im Dokument
 * `docs/datenlage-round-table.html` sechs Punkte, die als Rechte- oder
 * Aufwandsfrage geführt wurden, obwohl niemand sie je gemessen hatte. Jeder
 * davon lässt sich mit EINEM lesenden Aufruf entscheiden. Ohne die Messung
 * ist jede Aufwandsschätzung geraten — und geratene Schätzungen sind der
 * Grund, warum ein Punkt jahrelang auf einer Liste stehen bleibt.
 *
 * WARUM NICHT AUS DER AGENTENUMGEBUNG. `AGENTS.md` Regel 7a: LINA weist die
 * Anmeldung aus dem Netzweg der Agentenumgebung ab, mit der irreführenden
 * Meldung „Benutzername oder Passwort ist falsch!". Derselbe Befehl im
 * Terminal des Nutzers meldet sich beim ersten Versuch an. Deshalb ist das
 * hier ein Befehl zum Selberstarten und kein Skript, das ein Agent aufruft.
 *
 * WAS DIESE DATEI NICHT TUT: schreiben. Weder in LINA (Regel 1) noch in die
 * eigene Datenbank. `LinaClient.holen()` holt und gibt zurück; das Ablegen in
 * `raw.api_antwort` macht `sync/laden.ts`, und das läuft hier nicht. Die
 * Drosselung, das Tagesbudget und die Anmelde-Notbremse aus Regel 7 gelten
 * unverändert — der Client ist derselbe wie im Sync.
 *
 *   bun run messen              # Liste aller Messungen
 *   bun run messen d1           # eine Messung
 *   bun run messen d1 --roh     # zusätzlich die ersten 4000 Zeichen der Antwort
 *
 * Jede Messung sagt VORHER, welche Antwort welche Schlussfolgerung erlaubt.
 * Das ist Absicht: wer den Schluss erst nach dem Ergebnis formuliert, findet
 * immer einen.
 */
import { LinaClient } from './lina/client'
import type { Endpunkt } from './lina/endpunkte'
import { zuLinaDatum } from './lib/time'

type Messung = {
  id: string
  frage: string
  /** Was der Aufruf tut — in einem Satz, ohne Fachjargon. */
  aufruf: string
  pfad: string
  parameter: Record<string, string>
  /** Antwort -> Schlussfolgerung. Vor dem Aufruf festgelegt. */
  deutung: [string, string][]
}

/** Ein Zeitraum, der garantiert Daten hat: eine ruhige Woche im Juni 2026. */
const VON = '2026-06-08'
const BIS = '2026-06-14'

const zeitraum = {
  von: zuLinaDatum(VON),
  bis: zuLinaDatum(BIS),
  reltime: 'custom',
  brutto: '0',
  preExistingRevenue: '0',
}

const MESSUNGEN: Messung[] = [
  {
    id: 'd1',
    frage: 'Kassenjournal: Rechtefrage oder Aufwandsfrage?',
    aufruf: 'Kassenjournal für eine Woche abrufen und Format sowie Umfang ansehen.',
    pfad: '/finanzen/report/kassenjournal',
    parameter: zeitraum,
    deutung: [
      ['HTTP 403 / „keine Berechtigung"',
       'RECHTEFRAGE. Der Punkt bleibt im Dokument und geht als Freigabe an Concept Family.'],
      ['HTTP 200 mit Daten (HTML oder JSON)',
       'AUFWANDSFRAGE. Der Punkt verlässt die Rechteliste. Dann zählen: Zeilen je Tag, '
       + 'ob eine Bon-ID und ein Zeitstempel dabei sind, ob Artikelzeilen am Bon hängen. '
       + 'Erst das entscheidet über 5.1, Zusatzverkäufe und Wartezeiten.'],
      ['HTTP 200, aber nur eine Eingabemaske ohne Daten',
       'Der Bericht ist formulargesteuert. Dann die Feldnamen aus dem HTML notieren — '
       + 'sie sind die Parameter für den nächsten Versuch.'],
      ['HTTP 500 mit leerem Body',
       'LINAs Normalantwort für „keine Daten in diesem Zeitraum" (siehe AGENTS.md). '
       + 'Zeitraum wechseln, NICHT wiederholen.'],
    ],
  },
  {
    id: 'd2',
    frage: 'Bericht 107 „Gearbeitete Stunden" auf BETRIEBSebene — geht er dort?',
    aufruf: 'Report 107 einmal mit Betriebs-Kontext statt auf Konzernebene abrufen.',
    pfad: '/finanzen/analytics/getReport',
    parameter: { ...zeitraum, report: '107', ebene: 'betrieb' },
    deutung: [
      ['HTTP 200 mit Stundenwerten',
       'Die gesamte Rückrechnung aus core.personalkosten (Umsatz ÷ eff) wird überflüssig — '
       + 'dann kommen die Stunden direkt. Nachsehen, ob je SCHICHT und BEREICH oder nur je Tag: '
       + 'davon hängt ab, ob Kapitel 2.3 erfüllbar ist.'],
      ['HTTP 500 wie auf Konzernebene',
       'Der Bericht ist auch je Betrieb gesperrt. Dann bleibt es bei der Rückrechnung — '
       + 'die ist am 11.08.2026 gegen die BWA geprüft und trägt (Median-Stundenlohn 21,12 €, '
       + '97,7 % der Betriebsmonate im plausiblen Band). Der Punkt verlässt das Dokument trotzdem, '
       + 'weil die Kennzahl auch ohne 107 rechenbar ist.'],
      ['HTTP 403',
       'RECHTEFRAGE, nicht Technik. Bleibt im Dokument.'],
    ],
  },
  {
    id: 'd3',
    frage: 'Reservierungen: wie viel deckt LINA schon ab — und wie groß muss OpenTable werden?',
    aufruf: 'Die Reservierungs-Zusammenfassung der Dienstplan-API für eine Woche abrufen.',
    pfad: '/personal/dienstplan-api/reservation-summary',
    parameter: { von: zuLinaDatum(VON), bis: zuLinaDatum(BIS) },
    deutung: [
      ['JSON mit Gästezahl je Betrieb und Zeitfenster',
       'Deckt „Gäste je Zeitzone" aus Kapitel 1.3 ab. Die OpenTable-Anbindung schrumpft dann auf '
       + 'No-Show, Vorlaufzeit, Sitzdauer und Warteliste.'],
      ['JSON, aber nur Summen je Tag',
       'Hilft für 1.3 nicht. OpenTable bleibt in vollem Umfang nötig.'],
      ['„Keine Berechtigung für diesen Dienstplan"',
       'Dieselbe Sperre wie beim Dienstplan selbst — eine Freigabe löst beide. '
       + 'Im Dokument zusammenfassen, nicht als zwei Anfragen führen.'],
    ],
  },
  {
    id: 'd4',
    frage: 'Deckt LINAs Wetterbericht den Wetterbedarf aus Kapitel 7.1?',
    aufruf: 'Die Umsatz-Wetter-Statistik für eine Woche abrufen.',
    pfad: '/finanzen/stat/umsatzwetter',
    parameter: zeitraum,
    deutung: [
      ['Wetterlage je Betrieb und Tag',
       'Der letzte offene Punkt an mart.vergleichstag schließt sich. Dann eine Spalte '
       + 'wetter ergänzen — Feiertage und Ferien stehen seit Migration 0051 schon drin.'],
      ['Nur eine Wetterlage je Tag für die ganze Gruppe',
       'Unbrauchbar: die Betriebe liegen von Dresden bis Freiburg. Externe Wetterquelle '
       + 'je Koordinate — die Koordinaten stehen in manual.betrieb_standort.'],
      ['HTTP 403 / 404',
       'Externe Wetterquelle. Bleibt im Dokument, aber als kleine Aufgabe, nicht als Rechtefrage.'],
    ],
  },
  {
    id: 'd5',
    frage: 'Greift der Hauptsparten-Filter im Zeitzonenbericht?',
    aufruf: 'Zeitzonenbericht einmal mit hauptsparten=10001 (Speisen) abrufen.',
    pfad: '/intranet/analytics/getZeitzonenbericht',
    parameter: { ...zeitraum, hauptsparten: '10001' },
    deutung: [
      ['Werte, die niedriger sind als ohne Filter',
       'Der Filter greift. Dann liefern ZWEI Aufrufe je Tag (10001 Speisen, 10002 Getränke) '
       + 'den Speisen-/Getränke-Anteil je Zeitfenster — eine der sechs Lücken in Kapitel 1.3, '
       + 'für rund 700 zusätzliche Aufrufe im Jahr.'],
      ['Dieselben Werte wie ohne Filter',
       'Der Parameter wird ignoriert. Der Spartenanteil je Zeitfenster bleibt offen. '
       + 'GEGENPROBE PFLICHT: denselben Aufruf ohne hauptsparten und die Summen vergleichen — '
       + 'sonst hält man einen ignorierten Filter für einen wirkungslosen.'],
      ['HTTP 500',
       'Parametername falsch. In docs/lina-api-inventar-1c.md gegen die dort notierte '
       + 'Schreibweise prüfen, nicht raten.'],
    ],
  },
]

/**
 * D6 läuft nicht über LINA, sondern über Yext — anderer Client, anderer
 * Zugang, keine Anmeldesperre. Deshalb steht die Anleitung hier als Text und
 * nicht als Eintrag oben: sie gehört in `bun run yext`, sobald jemand die
 * Dimension aufnimmt.
 */
const D6 = `
d6  Yext-Analytics mit der Dimension USER_NAME — Antwortverhalten je Bearbeiter

    Läuft NICHT über diesen Befehl: Yext hat einen eigenen Client
    (src/yext/client.ts) und einen API-Key statt einer Sitzung. Der Aufruf ist
    eine Zeile in einer Bun-Konsole:

      bun repl
      > const { bericht } = await import('./src/yext/client.ts')
      > await bericht(['REVIEW_RESPONSE_COUNT','AVERAGE_RESPONSE_TIME'],
                      ['USER_NAME'],
                      { dateRange: { start: '2026-06-01', end: '2026-06-30' } })

    Deutung:
      Zeilen mit Namen      -> Antwortverhalten je Bearbeiter ist messbar. Damit
                               wird Kapitel 3.1 auf Personenebene rechenbar, ohne
                               Bounti. Dann ANTWORTNAME in src/yext/client.ts um
                               die beiden Metriken ergänzen und in den Nachlauf
                               aufnehmen.
      Leere Antwort         -> Die Dimension existiert, aber niemand antwortet über
                               Yext. Dann ist der Punkt erledigt, nicht offen.
      Fehler "unknown
      dimension USER_NAME"  -> Die Dimension gibt es im gebuchten Paket nicht.
                               Bleibt im Dokument, als Frage an Yext.
`

function hilfe() {
  console.log(`
Einmalige LESENDE Messaufrufe gegen LINA.

  bun run messen <id> [--roh]

Jeder Aufruf ist EIN Request. Der Client drosselt, führt das Tagesbudget und
bricht nach EINEM gescheiterten Anmeldeversuch ab (AGENTS.md Regel 7).
Geschrieben wird nirgends — weder in LINA noch in die eigene Datenbank.
`)
  for (const m of MESSUNGEN) {
    console.log(`${m.id}  ${m.frage}`)
    console.log(`    ${m.aufruf}`)
    console.log(`    GET ${m.pfad}`)
    for (const [antwort, schluss] of m.deutung) {
      console.log(`      ${antwort}`)
      console.log(`        -> ${schluss.replace(/\s+/g, ' ')}`)
    }
    console.log()
  }
  console.log(D6)
}

const id = process.argv[2]?.toLowerCase()
const roh = process.argv.includes('--roh')

if (!id || id === '--help' || id === '-h') {
  hilfe()
  process.exit(0)
}

if (id === 'd6') {
  console.log(D6)
  process.exit(0)
}

const messung = MESSUNGEN.find(m => m.id === id)
if (!messung) {
  console.error(`Unbekannte Messung: ${id}`)
  hilfe()
  process.exit(1)
}

// Ad-hoc-Endpunkt: absichtlich nicht in ENDPUNKTE aufgenommen. Was dort steht,
// reiht der Sync automatisch ein — und genau das soll hier nicht passieren.
const ep: Endpunkt = {
  key: `messen:${messung.id}`,
  ebene: 'konzern',
  pfad: messung.pfad,
  schrittweite: 'tag',
  parameter: () => messung.parameter,
  zweck: messung.frage,
  aktiv: false,
}

console.log(`\n${messung.id}  ${messung.frage}`)
console.log(`GET ${messung.pfad}`)
console.log(`Parameter: ${JSON.stringify(messung.parameter)}\n`)

const client = new LinaClient()
const r = await client.holen(ep, messung.parameter)

console.log(`Ergebnis: ${r.art}`)
if ('status' in r && r.status !== null) console.log(`HTTP:     ${r.status}`)
if ('dauerMs' in r) console.log(`Dauer:    ${r.dauerMs} ms`)
if (r.art === 'ok') {
  console.log(`Bytes:    ${r.bytes}`)
  const text = typeof r.daten === 'string' ? r.daten : JSON.stringify(r.daten)
  const istJson = typeof r.daten !== 'string'
  console.log(`Form:     ${istJson ? 'JSON' : text.trimStart().startsWith('<') ? 'HTML' : 'Text'}`)
  if (istJson && r.daten && typeof r.daten === 'object') {
    console.log(`Schlüssel oberste Ebene: ${Object.keys(r.daten as object).join(', ')}`)
  }
  console.log(`\nErste 400 Zeichen:\n${text.slice(0, 400)}`)
  if (roh) console.log(`\n--- roh (4000 Zeichen) ---\n${text.slice(0, 4000)}`)
} else if ('fehler' in r) {
  console.log(`Fehler:   ${r.fehler}`)
}

console.log(`\nDeutung:`)
for (const [antwort, schluss] of messung.deutung) {
  console.log(`  ${antwort}\n    -> ${schluss.replace(/\s+/g, ' ')}`)
}
