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
 *   bun run lina-fragen              # Liste aller Messungen
 *   bun run lina-fragen d1           # eine Messung
 *   bun run lina-fragen d1 --roh     # zusätzlich die ersten 4000 Zeichen der Antwort
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
  /** Einschrittige Messung: ein Pfad, ein Parametersatz, ein Request. */
  pfad?: string
  parameter?: Record<string, string>
  /**
   * Mehrschrittige Messung. Manche Fragen lassen sich mit einem Aufruf nicht
   * beantworten — ob eine Seitengroesse trägt, sieht man erst im Vergleich
   * mehrerer Seitengroessen, und wie lange ein Token gilt, erst nach dem
   * Warten. Solche Messungen bringen ihren Ablauf selbst mit und geben ihren
   * Bericht als Text zurueck.
   *
   * Sie benutzen denselben gedrosselten `LinaClient` wie alles andere. Ein
   * eigenes `fetch` daneben wuerde Takt, Tagesbudget und Anmelde-Notbremse
   * gleichzeitig umgehen.
   */
  lauf?: (client: LinaClient) => Promise<string>
  /** Antwort -> Schlussfolgerung. Vor dem Aufruf festgelegt. */
  deutung: [string, string][]
}

/** Ad-hoc-Endpunkt fuer eine Messung. Absichtlich nicht in ENDPUNKTE. */
const adhoc = (
  key: string, pfad: string, form: 'json' | 'html' = 'json',
): Endpunkt => ({
  key: `messen:${key}`,
  ebene: 'konzern',
  pfad,
  schrittweite: 'tag',
  parameter: () => ({}),
  zweck: `Messung ${key}`,
  aktiv: false,
  form,
})

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Enchilada Karlsruhe. Am 11.08.2026 mit 8.383 Eingangsrechnungen gemessen —
 * genug fuer mehrere Seiten, klein genug, um niemanden zu belasten.
 */
const MESS_BETRIEB = 15

/**
 * Holt einen `storeId`-Token fuer das Belegarchiv eines Betriebs.
 *
 * Zwei Aufrufe: der Baumknoten nennt die Ordner samt Link, die Ordnerseite
 * traegt den Token im eingebetteten `getFilesUrl`. Der Token ist je Anfrage
 * neu gesalzen und gilt fuer alle Belegarten desselben Betriebs.
 */
async function belegarchivToken(
  client: LinaClient, betriebId: number,
): Promise<{ token: string; schritte: string[] }> {
  const schritte: string[] = []

  const baum = await client.holen(
    adhoc('la_baum', '/intranet/ladenakte/baum/admin/1', 'json'),
    { id: `belegarchiv_${betriebId}` })
  if (baum.art !== 'ok') throw new Error(`Baumknoten: ${baum.art} — ${'fehler' in baum ? baum.fehler : ''}`)
  const ordner = baum.daten as Array<{ text: string; a_attr: Record<string, string> }>
  schritte.push(`Baumknoten: ${ordner.length} Ordner`)

  const eingang = ordner.find(o => /Eingangsrechnungen/.test(o.text))
  if (!eingang) throw new Error('Ordner "Eingangsrechnungen und Avise" nicht gefunden')

  const link = new URL(eingang.a_attr['data-link'], 'https://x')
  const seite = await client.holen(
    adhoc('la_ordner', link.pathname, 'html'),
    Object.fromEntries(link.searchParams))
  if (seite.art !== 'ok') throw new Error(`Ordnerseite: ${seite.art} — ${'fehler' in seite ? seite.fehler : ''}`)

  const treffer = String(seite.daten).match(/getFilesUrl = '([^']+)'/)
  if (!treffer) throw new Error('getFilesUrl nicht in der Ordnerseite gefunden')
  const token = new URL(treffer[1], 'https://x').searchParams.get('storeId')
  if (!token) throw new Error('storeId fehlt in getFilesUrl')
  schritte.push(`Token geholt (${token.length} Zeichen)`)

  return { token, schritte }
}

/** Eine Seite der Belegliste. Gibt IDs und Gesamtzahl zurueck. */
async function belegSeite(
  client: LinaClient, token: string,
  opt: { typeId?: string; start?: number; length?: number; spalte?: number; richtung?: string },
): Promise<{ ids: number[]; total: number; geliefert: number }> {
  const r = await client.holen(adhoc('la_liste', '/intranet/ladenakte/beleglist', 'json'), {
    admin: '1', storeId: token, typeId: opt.typeId ?? '1', draw: '1',
    start: String(opt.start ?? 0), length: String(opt.length ?? 200),
    'order[0][column]': String(opt.spalte ?? 0),
    'order[0][dir]': opt.richtung ?? 'asc',
  })
  if (r.art !== 'ok') throw new Error(`Belegliste: ${r.art} — ${'fehler' in r ? r.fehler : ''}`)
  const j = r.daten as { data?: Array<{ id: number }>; recordsTotal?: number }
  const zeilen = j.data ?? []
  return { ids: zeilen.map(z => z.id), total: j.recordsTotal ?? -1, geliefert: zeilen.length }
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

  // ---------------------------------------------------------------------
  // d7-d9: die drei offenen Punkte des Belegarchiv-Abzugs.
  //
  // Sie stehen hier, weil der Abzug ohne sie nicht dimensionierbar ist. Am
  // 11.08.2026 lief die Browser-Sitzung ab, bevor sie gemessen werden konnten
  // — dokumentiert in docs/lina-api-inventar-ladenakte.md, Abschnitt 10.
  // Solange sie offen sind, arbeitet der Lader mit den vorsichtigen Annahmen
  // 200 Zeilen je Seite, aufsteigend nach ID, Token je Betrieb neu.
  // ---------------------------------------------------------------------
  {
    id: 'd7',
    frage: 'Belegliste: wie viele Zeilen liefert eine Seite höchstens?',
    aufruf: 'Dieselbe Seite viermal abrufen, mit length 200, 500, 1000 und 2000.',
    deutung: [
      ['Alle vier liefern, was sie sollen',
       'Der Abzug läuft mit length=1000. Statt 3.366 Seitenaufrufen sind es 1.099 — '
       + 'aus fast fünf Stunden werden anderthalb. Wert in den Lader übernehmen.'],
      ['Ab einem Wert wird gedeckelt (z. B. immer 1000)',
       'Die Deckelung IST die Obergrenze. Mit genau diesem Wert rechnen, nicht mit dem '
       + 'angefragten — sonst hält der Lader eine gekürzte Seite für eine vollständige '
       + 'und überspringt still den Rest.'],
      ['Grosse Werte scheitern oder laufen in die Zeitüberschreitung',
       'Bei 200 bleiben. Die 3.366 Seiten sind kein Problem, nur Zeit.'],
    ],
    lauf: async (client) => {
      const { token, schritte } = await belegarchivToken(client, MESS_BETRIEB)
      const zeilen = [...schritte]
      for (const length of [200, 500, 1000, 2000]) {
        try {
          const s = await belegSeite(client, token, { length })
          const gedeckelt = s.geliefert < length && s.geliefert < s.total
          zeilen.push(
            `length=${String(length).padStart(4)}  ->  geliefert ${String(s.geliefert).padStart(4)}`
            + `  (Bestand ${s.total})${gedeckelt ? '   << GEDECKELT' : ''}`)
        } catch (e) {
          zeilen.push(`length=${String(length).padStart(4)}  ->  FEHLER: ${(e as Error).message}`)
        }
      }
      return zeilen.join('\n')
    },
  },
  {
    id: 'd8',
    frage: 'Blättern: liefert aufsteigend nach ID lückenlose, überschneidungsfreie Seiten?',
    aufruf: 'Seite 1 und Seite 2 aufsteigend nach ID holen und die IDs vergleichen; '
          + 'dieselbe Seite 1 zusätzlich absteigend nach Hochladedatum.',
    deutung: [
      ['Aufsteigend: Seite 2 überschneidet Seite 1 nicht, IDs steigen durchgehend',
       'So wird geblättert. Neue Belege landen am Ende und verschieben nichts — '
       + 'der Abzug ist dann auch über Stunden vollständig.'],
      ['Aufsteigend funktioniert nicht, absteigend schon',
       'Dann bleibt nur absteigend. ACHTUNG: jeder während des Laufs hochgeladene Beleg '
       + 'schiebt das Seitenraster um eine Position weiter — das erzeugt LÜCKEN, nicht nur '
       + 'Dubletten. Dann muss der Lader die gesehenen IDs mitführen und am Ende gegen '
       + 'recordsTotal prüfen, statt sich auf das Raster zu verlassen.'],
      ['Die Sortierspalte wird ignoriert (beide Reihenfolgen gleich)',
       'Die Reihenfolge ist serverseitig fest. Dann gilt dieselbe Vorsicht wie oben: '
       + 'IDs mitführen, Vollständigkeit am Schluss zählen.'],
    ],
    lauf: async (client) => {
      const { token, schritte } = await belegarchivToken(client, MESS_BETRIEB)
      const zeilen = [...schritte]

      const a1 = await belegSeite(client, token, { start: 0, length: 200, spalte: 0, richtung: 'asc' })
      const a2 = await belegSeite(client, token, { start: 200, length: 200, spalte: 0, richtung: 'asc' })
      const d1 = await belegSeite(client, token, { start: 0, length: 200, spalte: 6, richtung: 'desc' })

      const schnitt = a1.ids.filter(i => a2.ids.includes(i))
      const steigend = a1.ids.every((v, i, arr) => i === 0 || arr[i - 1] <= v)
      const luecke = a2.ids.length > 0 && a1.ids.length > 0
        ? Math.min(...a2.ids) > Math.max(...a1.ids) : false

      zeilen.push(
        `Bestand laut recordsTotal: ${a1.total}`,
        '',
        `aufsteigend (Spalte 0)  Seite 1: ${a1.geliefert} Zeilen, ID ${a1.ids[0]} .. ${a1.ids[a1.ids.length - 1]}`,
        `aufsteigend (Spalte 0)  Seite 2: ${a2.geliefert} Zeilen, ID ${a2.ids[0]} .. ${a2.ids[a2.ids.length - 1]}`,
        `absteigend  (Spalte 6)  Seite 1: ${d1.geliefert} Zeilen, ID ${d1.ids[0]} .. ${d1.ids[d1.ids.length - 1]}`,
        '',
        `IDs auf Seite 1 aufsteigend sortiert: ${steigend ? 'ja' : 'NEIN'}`,
        `Ueberschneidung Seite 1 / Seite 2:    ${schnitt.length} IDs${schnitt.length ? '   << PROBLEM' : ''}`,
        `Seite 2 beginnt hinter Seite 1:       ${luecke ? 'ja' : 'NEIN   << PROBLEM'}`,
        `Reihenfolge asc und desc verschieden: ${a1.ids[0] !== d1.ids[0] ? 'ja' : 'NEIN — Sortierung wird ignoriert'}`,
      )
      return zeilen.join('\n')
    },
  },
  {
    id: 'd9',
    frage: 'Wie lange gilt ein storeId-Token?',
    aufruf: 'Einen Token holen und ihn nach 0, 1, 3 und 6 Minuten erneut verwenden. '
          + 'Dauert rund sieben Minuten.',
    deutung: [
      ['Alle vier Versuche liefern Daten',
       'Der Token überlebt einen Betrieb mühelos. Ein Token je Betrieb reicht, der Lader '
       + 'holt ihn einmal und blättert damit durch alle Belegarten. Günstigster Fall.'],
      ['Er fällt nach einigen Minuten aus',
       'Die gemessene Zeit ist die Obergrenze. Der Lader erneuert den Token nach der '
       + 'HÄLFTE davon — und zusätzlich immer dann, wenn eine Seite leer zurückkommt, '
       + 'obwohl recordsTotal mehr verspricht. Auf die Zeit allein darf er sich nicht verlassen.'],
      ['Schon der Versuch nach einer Minute scheitert',
       'Der Token ist an die einzelne Anfrage gebunden. Dann kostet jede Seite zwei '
       + 'Aufrufe statt einem — der Abzug verdoppelt sich auf rund 6.700 Aufrufe. '
       + 'Das ist ärgerlich, aber machbar; es muss nur vorher bekannt sein.'],
    ],
    lauf: async (client) => {
      const { token, schritte } = await belegarchivToken(client, MESS_BETRIEB)
      const zeilen = [...schritte]
      const start = Date.now()
      const pausen = [0, 60, 120, 180]   // kumuliert 0, 1, 3, 6 Minuten
      for (const p of pausen) {
        if (p > 0) {
          zeilen.push(`... ${p} s warten`)
          await schlaf(p * 1000)
        }
        const alter = Math.round((Date.now() - start) / 1000)
        try {
          const s = await belegSeite(client, token, { length: 1 })
          zeilen.push(`nach ${String(alter).padStart(3)} s: ${s.geliefert} Zeile(n), Bestand ${s.total}  -> Token gilt`)
        } catch (e) {
          zeilen.push(`nach ${String(alter).padStart(3)} s: FEHLER -> Token abgelaufen: ${(e as Error).message}`)
          break
        }
      }
      return zeilen.join('\n')
    },
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

  bun run lina-fragen <id> [--roh]

d1-d5 sind je EIN Request. d7-d9 brauchen mehrere und sagen das dazu.
Der Client drosselt, führt das Tagesbudget und bricht nach EINEM gescheiterten
Anmeldeversuch ab (AGENTS.md Regel 7).
Geschrieben wird nirgends — weder in LINA noch in die eigene Datenbank.
`)
  for (const m of MESSUNGEN) {
    console.log(`${m.id}  ${m.frage}`)
    console.log(`    ${m.aufruf}`)
    if (m.pfad) console.log(`    GET ${m.pfad}`)
    else console.log(`    mehrere Aufrufe`)
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

console.log(`\n${messung.id}  ${messung.frage}`)

const client = new LinaClient()

// Mehrschrittige Messung: sie bringt ihren Ablauf selbst mit.
if (messung.lauf) {
  console.log(`${messung.aufruf}\n`)
  try {
    console.log(await messung.lauf(client))
  } catch (e) {
    console.log(`Abgebrochen: ${(e as Error).message}`)
  }
  console.log(`\nDeutung:`)
  for (const [antwort, schluss] of messung.deutung) {
    console.log(`  ${antwort}\n    -> ${schluss.replace(/\s+/g, ' ')}`)
  }
  process.exit(0)
}

if (!messung.pfad || !messung.parameter) {
  console.error(`Messung ${messung.id} hat weder Pfad noch eigenen Ablauf.`)
  process.exit(1)
}

// Ad-hoc-Endpunkt: absichtlich nicht in ENDPUNKTE aufgenommen. Was dort steht,
// reiht der Sync automatisch ein — und genau das soll hier nicht passieren.
const ep: Endpunkt = {
  key: `messen:${messung.id}`,
  ebene: 'konzern',
  pfad: messung.pfad,
  schrittweite: 'tag',
  parameter: () => messung.parameter ?? {},
  zweck: messung.frage,
  aktiv: false,
}

console.log(`GET ${messung.pfad}`)
console.log(`Parameter: ${JSON.stringify(messung.parameter)}\n`)

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
