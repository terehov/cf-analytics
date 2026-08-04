// =====================================================================
// Passt der Inhalt jeder Kachel in ihre Breite?
//
// Zwei Pruefungen, beide gegen denselben Fehler: die Kachel ist zu
// schmal fuer das, was drinsteht, und Metabase meldet das nicht, sondern
// laesst still etwas weg.
//
//   TABELLEN  Zu viele Spalten -> waagerechtes Scrollen. Gemeldet am
//             28.07.2026: "Betrieb — Kennzahlen des Monats" fuehrte neun
//             Spalten auf sechzehn Rastereinheiten, die Filialtabelle
//             zwanzig auf fuenfzehn. Wer scrollen muss, um die dritte
//             Spalte zu sehen, vergleicht die erste nicht mehr mit ihr --
//             und genau dafuer ist eine Tabelle da.
//
//   DIAGRAMME Zu viele Kategorien -> Metabase laesst die Achsen-
//             beschriftung WEG. Gemeldet am 28.07.2026: "Beim 'Betrieb -
//             Tagesverlauf' sieht man keine Stunden auf der x Skala."
//             Nachgemessen: 24 Balken auf acht Einheiten sind 14 Pixel
//             je Balken, eine Uhrzeit braucht rund 40. Uebrig blieb der
//             Achsentitel "Stunde" ueber unbeschrifteten Balken -- man
//             sieht ein Muster und kann es keiner Tageszeit zuordnen.
//
// Warum ein eigenes Skript und keine Pruefung in uebernehmen.ts: weder
// Spalten- noch Kategorienzahl stehen im Quelltext. Ein SELECT * mit
// sechs coalesce-Ausdruecken sieht nach sechs Spalten aus und liefert
// neun, sobald eine CTE dazukommt. Die einzige ehrliche Quelle ist die
// Datenbank, und die soll das Provisionieren nicht brauchen.
//
//   bun run metabase/tabellenbreite.ts
//
// Das Skript aendert nichts. Es sagt, welche Kachel zu schmal ist und wie
// breit sie sein muesste.
// =====================================================================

import { karten as kartenRoundTable } from './karten-round-table'
import { karten as kartenFach } from './karten-fach'
import { karten as kartenDrilldown } from './karten-drilldown'
import { karten as kartenPortfolio } from './karten-portfolio'
import { karten as kartenImport } from './karten-import'
import { karten as kartenStandort } from './karten-standort'
import { karten as kartenBewertung } from './karten-bewertung'
import { karten as kartenAktionen } from './karten-aktionen'
import { dashboards } from './dashboards'
import { auslegen } from './layout'
import { Client } from 'pg'

const alleKarten = [
  ...kartenDrilldown, ...kartenPortfolio, ...kartenRoundTable,
  ...kartenFach, ...kartenImport, ...kartenStandort, ...kartenBewertung,
  ...kartenAktionen,
]
const typVon = (s: string) => alleKarten.find(k => k.schluessel === s)?.anzeige

// ---------------------------------------------------------------------
// Wie breit wird eine Spalte im Browser?
//
// Gerechnet wird in PIXELN, und die Formel ist an der gerenderten Tabelle
// abgelesen -- nicht hergeleitet. Zwei Beobachtungen vom 28.07.2026:
//
//   1. Metabase gibt jeder Spalte eine MINDESTBREITE, unabhaengig vom
//      Inhalt. "Offen" mit fuenf Zeichen belegt 74 Pixel, "Lauf" mit
//      vier belegt 66. Ein reines Zeichenmass unterschaetzt deshalb jede
//      Tabelle mit vielen kurzen Spalten -- und genau die scrollten,
//      obwohl die erste Fassung dieser Pruefung sie durchwinkte.
//   2. Darueber hinaus kostet jedes Zeichen rund 8 Pixel.
//
// Beides zusammen: MINDEST_PX je Spalte, und was laenger ist, wird mit
// PX_JE_ZEICHEN aufgeschlagen.
// ---------------------------------------------------------------------
const MINDEST_PX = 70
const PX_JE_ZEICHEN = 8

/**
 * Obergrenze je Spalte. Metabase laesst eine Spalte nicht beliebig breit
 * werden, sondern schneidet den Text ab -- der laengste Betriebsname in
 * 200 Zeilen ("BS Bier & Speisen Gastro - Lauterbacher am See") wuerde
 * die Rechnung sonst allein bestimmen, obwohl im Browser nichts scrollt.
 * Abgelesen an der Betriebsspalte: 231 Pixel bei 27 Zeichen.
 */
const HOECHST_PX = 240

/** Ab wie vielen Zeichen eine Spalte ueber die Mindestbreite hinauswaechst. */
const ZEICHEN_IN_MINDESTBREITE = Math.floor(MINDEST_PX / PX_JE_ZEICHEN)

/**
 * Pixel je Rastereinheit. Das Raster hat 24 Einheiten; eine Kachel ueber
 * die volle Breite mass im Browser 1048 Pixel.
 */
const PX_JE_EINHEIT = 1048 / 24

function spaltenBreite(zeichen: number): number {
  if (zeichen <= ZEICHEN_IN_MINDESTBREITE) return MINDEST_PX
  return Math.min(HOECHST_PX,
    MINDEST_PX + (zeichen - ZEICHEN_IN_MINDESTBREITE) * PX_JE_ZEICHEN)
}

/** Platzhalter so ersetzen, dass die Abfrage ohne Metabase laeuft:
 *  optionale Bloecke fallen weg, Variablen werden zu NULL. Die
 *  Spaltenliste aendert sich dadurch nicht -- nur die Zeilen. */
function ausfuehrbar(sql: string): string {
  return sql.replace(/\[\[[^\]]*\]\]/g, '').replace(/\{\{\s*\w+\s*\}\}/g, 'NULL')
}

const db = new Client({ connectionString: process.env.DATABASE_URL })

// Datum und Zeitstempel als TEXT holen, nicht als JS-Date.
//
// Sonst misst dieses Skript sich selbst statt der Karte: der Treiber baut
// aus einem `date` ein JavaScript-Date, und String() daraus ist
// '2022-09-07T00:00:00.000Z' -- 62 Zeichen fuer einen Tag, den Metabase
// als '2022-09-07' zeigt. Ein ::date im SQL sah dadurch wirkungslos aus,
// obwohl es genau richtig war.
for (const oid of [1082 /* date */, 1114 /* timestamp */, 1184 /* timestamptz */]) {
  ;(db as any).setTypeParser?.(oid, (v: string) => v)
}
await db.connect()

// Die Warenwirtschaft liegt auf 14 Millionen Zeilen; ein LIMIT 200 darauf
// braucht Minuten, weil erst sortiert und gruppiert wird. Fuer die
// Spaltenbreite ist das verschwendete Zeit -- laeuft eine Abfrage in die
// Grenze, wird aus dem Spaltentyp geschaetzt statt gewartet.
await db.query(`SET statement_timeout = '4s'`)

/**
 * Breite je Spaltentyp, wenn keine echten Werte vorliegen.
 * Abgelesen an den gemessenen Karten, nicht geraten.
 */
function breiteAusTyp(typ: string): number {
  // 29, nicht 19: Postgres liefert einen Zeitstempel mit Mikrosekunden
  // und Zeitzone aus ('2026-07-26 14:30:00.123456+00'). Ein zu kurzer
  // Schaetzwert liess zwoelf Tabellen durchgehen, die im Browser
  // scrollten -- nachgemessen am 28.07.2026.
  if (/timestamp/.test(typ)) return 29
  if (/date/.test(typ)) return 10        // '2026-07-26'
  if (/int|numeric|float|double/.test(typ)) return 10
  if (/bool/.test(typ)) return 5
  return 24                              // Text: der Mittelwert der gemessenen
}

type Befund = {
  dashboard: string
  karte: string
  spalten: number
  zeichen: number
  breite: number
  noetig: number
  /** Die breitesten Spalten -- sie sind der Hebel, nicht die Anzahl. */
  dickste: string
}

// Spaltentypen kommen als OID; die Namen stehen in pg_type.
const typName = new Map<number, string>()
for (const t of (await db.query('SELECT oid, typname FROM pg_type')).rows) {
  typName.set(Number(t.oid), String(t.typname))
}

type Diagramm = {
  dashboard: string
  karte: string
  achse: string
  kategorien: number
  breite: number
  noetig: number
}

/**
 * Platz je waagerechter Achsenbeschriftung.
 *
 * "08:00" sind fuenf Zeichen und braucht mit Abstand rund 40 Pixel.
 * Darunter laesst Metabase die Beschriftung weg -- ohne Hinweis, ohne
 * Fehlermeldung, einfach ohne Text unter den Balken.
 */
const PX_JE_BESCHRIFTUNG = 40

/**
 * Diagramme, bei denen die einzelne Achsenbeschriftung nicht gebraucht
 * wird. Jeder Eintrag braucht einen Grund -- sonst ist das hier die
 * Stelle, an der ein echter Befund verschwindet.
 */
const ACHSE_EGAL: Record<string, string> = {
  pf_konzentration_kurve:
    'Lorenzkurve. Die Achse ist ein Prozentkontinuum von 0 bis 100 -- die Aussage '
    + 'steckt in der KRUEMMUNG, nicht in einzelnen Punkten. Wer wissen will, welcher '
    + 'Betrieb wo steht, liest die Tabelle daneben.',
}

const befunde: Befund[] = []
const diagramme: Diagramm[] = []
let geprueft = 0
let geprueftDiagramme = 0
let geschaetzt = 0

for (const d of dashboards) {
  for (const kachel of auslegen(d.reihen, typVon)) {
    if (!kachel.karte) continue
    const k = alleKarten.find(x => x.schluessel === kachel.karte)
    if (!k) continue

    // ---- Diagramme: passen die Achsenbeschriftungen nebeneinander? ----
    if (['bar', 'line', 'combo', 'area'].includes(k.anzeige)) {
      const achse = ((k.visualisierung?.['graph.dimensions'] as string[]) ?? [])[0]
      if (!achse) continue
      if (ACHSE_EGAL[k.schluessel]) continue

      // Zeitachsen sind nicht gemeint. Bei 103 Monaten setzt Metabase
      // jede fuenfte Beschriftung, und die Linie bleibt lesbar -- eine
      // ausgelassene Jahreszahl kostet nichts. Bei "08:00" oder
      // "Happy Hour" ist jede ausgelassene Beschriftung ein Balken, den
      // man nicht mehr zuordnen kann.
      if (/monat|tag|datum|jahr|woche/i.test(achse)) continue

      let anzahl: number
      try {
        const r = await db.query(
          `SELECT count(*)::int AS n FROM (SELECT DISTINCT "${achse}" FROM (${ausfuehrbar(k.sql)}) t) u`)
        anzahl = r.rows[0].n
      } catch { continue }

      geprueftDiagramme++
      const px = kachel.breite * PX_JE_EINHEIT
      if (anzahl > 6 && px / anzahl < PX_JE_BESCHRIFTUNG) {
        diagramme.push({
          dashboard: d.schluessel, karte: k.schluessel, achse, kategorien: anzahl,
          breite: kachel.breite,
          noetig: Math.min(24, Math.ceil(anzahl * PX_JE_BESCHRIFTUNG / PX_JE_EINHEIT)),
        })
      }
      continue
    }

    if (k.anzeige !== 'table') continue

    // Echte Zeilen, nicht LIMIT 0: die Breite steckt in den Werten. 200
    // reichen -- der laengste Betriebsname taucht darin auf, und ein
    // Zeitstempel ist in jeder Zeile gleich lang.
    //
    // `fields` und nicht `Object.keys(zeilen[0])`: eine Tabelle kann leer
    // sein. Der erste Wurf dieses Skriptes las die Schluessel der ersten
    // Zeile, mass bei LIMIT 0 ueberall NULL Spalten und meldete "alle
    // Tabellen haben genug Breite", waehrend vier zu schmal waren. Eine
    // Pruefung, die durchgeht, weil sie nichts gemessen hat, ist
    // schlimmer als gar keine.
    let ergebnis
    let ausTyp = false
    try {
      ergebnis = await db.query(`SELECT * FROM (${ausfuehrbar(k.sql)}) t LIMIT 200`)
    } catch {
      // Zu langsam. Die Spalten bekommt man trotzdem -- ohne Zeilen.
      try {
        ergebnis = await db.query(`SELECT * FROM (${ausfuehrbar(k.sql)}) t LIMIT 0`)
        ausTyp = true
        geschaetzt++
      } catch (e) {
        console.log(`  ? ${d.schluessel} / ${k.schluessel}: ${String(e).slice(0, 80)}`)
        continue
      }
    }
    const spalten = ergebnis.fields.length
    if (spalten === 0) {
      throw new Error(`${k.schluessel} meldet null Spalten — die Messung ist kaputt, nicht die Karte.`)
    }

    // Breiteste Auspraegung je Spalte, Ueberschrift eingeschlossen.
    const je = ergebnis.fields.map(f => {
      const zeichen = Math.max(
        f.name.length,
        ausTyp || ergebnis.rows.length === 0
          ? breiteAusTyp(typName.get(f.dataTypeID) ?? '')
          : Math.max(...ergebnis.rows.map(r => String(r[f.name] ?? '').length)),
      )
      return { name: f.name, zeichen, breit: spaltenBreite(zeichen) }
    })
    const zeichen = je.reduce((s, x) => s + x.breit, 0)   // in Pixeln

    geprueft++
    const noetig = Math.min(24, Math.ceil(zeichen / PX_JE_EINHEIT))
    if (kachel.breite < noetig) {
      const dickste = [...je].sort((a, b) => b.breit - a.breit).slice(0, 3)
        .map(x => `${x.name} (${x.breit})`).join(', ')
      befunde.push({
        dashboard: d.schluessel, karte: k.schluessel,
        spalten, zeichen, breite: kachel.breite, noetig, dickste,
      })
    }
  }
}

await db.end()

// Kein einziger Messwert heisst kaputte Messung, nicht heile Dashboards.
if (geprueft === 0) throw new Error('Keine einzige Tabellenkachel gemessen — Skript pruefen.')

console.log(`${geprueft} Tabellenkacheln geprueft`
  + (geschaetzt > 0 ? `, davon ${geschaetzt} aus dem Spaltentyp geschaetzt (zu langsam fuer Zeilen)` : '')
  + `, dazu ${geprueftDiagramme} Diagramme mit kategorialer Achse.\n`)

if (befunde.length > 0) {
  console.log(`${befunde.length} Tabelle(n) zu schmal:\n`)
  for (const b of befunde.sort((x, y) => (y.noetig - y.breite) - (x.noetig - x.breite))) {
    console.log(`  ${b.dashboard} / ${b.karte}`)
    console.log(`      ${b.spalten} Spalten, ${b.zeichen} Pixel — `
      + `Kachel ${b.breite}, noetig ${b.noetig}`)
    console.log(`      breiteste: ${b.dickste}`)
  }
  console.log('\nZwei Hebel, in dieser Reihenfolge:')
  console.log('  1. Die breitesten Spalten schmaler machen -- ein Zeitstempel,')
  console.log('     wo ein Datum genuegt, kostet 50 Zeichen ohne Aussage.')
  console.log('  2. Die Kachel breiter legen (dashboards.ts).\n')
}

if (diagramme.length > 0) {
  console.log(`${diagramme.length} Diagramm(e) ohne lesbare Achsenbeschriftung:\n`)
  for (const g of diagramme.sort((x, y) => (y.noetig - y.breite) - (x.noetig - x.breite))) {
    const px = (g.breite * PX_JE_EINHEIT / g.kategorien).toFixed(1)
    console.log(`  ${g.dashboard} / ${g.karte}`)
    console.log(`      Achse "${g.achse}": ${g.kategorien} Kategorien auf ${g.breite} Einheiten `
      + `= ${px}px je Kategorie (noetig ${PX_JE_BESCHRIFTUNG})`)
    console.log(`      Kachel ${g.breite}, noetig ${g.noetig}`)
  }
  console.log('\nMetabase laesst die Beschriftung dann WEG, ohne es zu melden.')
  console.log('Kachel breiter legen -- oder, wenn 24 Einheiten nicht reichen,')
  console.log('die Kategorien zusammenfassen.\n')
}

if (befunde.length === 0 && diagramme.length === 0) {
  console.log('Alles passt in seine Kachel. Nichts zu tun.')
} else {
  process.exit(1)
}
