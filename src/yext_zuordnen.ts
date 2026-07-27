/**
 * Ordnet Yext-Entitaeten unseren Betrieben zu und schreibt das Ergebnis
 * nach manual.betrieb_fremd_id.
 *
 *     bun run src/yext_zuordnen.ts               nur anzeigen (Voreinstellung)
 *     bun run src/yext_zuordnen.ts --schreiben   uebernehmen
 *
 * QUELLE ist ein CSV-Export aus der Yext-Oberflaeche (Entitaeten, Spalten
 * Entitaets-ID, Yext-ID, Name, Adresse). Die Datei liegt in examples/ und
 * ist bewusst NICHT im Repository -- sie enthaelt Standortdaten des Kunden.
 * Das Skript ist die Herkunftsangabe, nicht die Datei.
 *
 * WARUM DIESE TABELLE UEBERHAUPT: Die Yext-Namen und unsere LINA-Namen
 * stimmen nicht ueberein. LINA fuehrt die Rechtsform mit ("Enchilada
 * Leipzig GmbH"), Yext nicht ("Enchilada Leipzig"). Bei zwei Standorten in
 * einer Stadt trennen die Namen sich voellig ("Aposto Wuppertal - Im
 * Gaskessel" gegen "Aposto Wuppertal GmbH"). Ein Namensabgleich zur
 * Laufzeit waere deshalb jedes Mal ein neues Raten. Einmal entschieden,
 * dauerhaft hinterlegt.
 *
 * WAS IN fremd_id STEHT: die Entitaets-ID (E_13), nicht die numerische
 * Yext-ID. Der Parameter `entityIds` der Reviews-API erwartet genau diese.
 */
import { Pool } from 'pg'
import { config } from './config'
import { log } from './lib/log'

const DATEI = new URL('../examples/CF Standorte Yext Entitäten.csv', import.meta.url)
const SCHREIBEN = process.argv.includes('--schreiben')

/**
 * Zuordnungen, die ein Mensch entschieden hat.
 *
 * Hier steht alles, was der automatische Abgleich NICHT eindeutig
 * hinbekommt -- zwei Standorte in einer Stadt, abweichende Hausnamen,
 * Tippfehler. Bewusst als Liste im Code und nicht als Heuristik: eine
 * Regel, die diese Faelle trifft, traefe naechstes Jahr auch die falschen.
 */
const VON_HAND: Record<string, number | null> = {
  // "Alte" gegen "Alter Papierfabrik" -- Tippfehler in LINA.
  A_15: 18,
  // Der Laden heisst bei Yext nach der Marke ("Enchilada Koeln"), in LINA
  // nach der Betreibergesellschaft ("COYACAN GmbH"). Kein Zeichen gemeinsam,
  // keine Heuristik der Welt findet das -- Eugene wusste es.
  E_33: 32,

  // Zwei Standorte in einer Stadt. Der Namensabgleich scheitert hier
  // zwangslaeufig: "Wilma Wunder Mainz am Markt" und "Gastronomie am Markt
  // Mainz GmbH" teilen nur "am Markt", und danach zu suchen waere die Sorte
  // Regel, die naechstes Jahr das Falsche trifft. Entschieden ueber die
  // Adresse, bestaetigt von Eugene am 27.07.2026:
  W_05: 65,   // Markt 11, 55116 Mainz
  A_14: 19,   // Mohrenstrasse 3, 42289 Wuppertal -- "Im Gaskessel"
  // Ballplatz 2, 55116 Mainz. Zwei Betriebe tragen "Ballplatz Mainz" im
  // Namen; genommen ist der ohne das Praefix "KUZ -" (105).
  W_01: 123,
}

/** Eine CSV-Zeile in Felder zerlegen, RFC-4180-Anfuehrungszeichen beachtet. */
function felder(zeile: string): string[] {
  const raus: string[] = []
  let feld = '', inAnf = false
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i]
    if (inAnf) {
      if (c === '"' && zeile[i + 1] === '"') { feld += '"'; i++ }
      else if (c === '"') inAnf = false
      else feld += c
    } else if (c === '"') inAnf = true
    else if (c === ',') { raus.push(feld); feld = '' }
    else feld += c
  }
  raus.push(feld)
  return raus
}

/**
 * Der Export ist doppelt kodiert: die ganze Zeile steckt noch einmal in
 * einem Anfuehrungszeichen-Paar, innere Zeichen sind verdoppelt.
 */
const auspacken = (z: string) => {
  const t = z.trim()
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t
}

/** Vergleichsform: Kleinbuchstaben, Umlaute aufgeloest, nur Buchstaben und Ziffern. */
const norm = (s: string) => s.toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '')

/**
 * Der Export schreibt Koordinaten mit Dezimalkomma ("51,6799470").
 * `Number('51,679')` ist NaN -- das faellt nicht auf, es wird nur still
 * nichts geschrieben. Deshalb ausdruecklich umgestellt.
 */
const koordinate = (s: string): number | null => {
  const t = (s ?? '').trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

type Entitaet = {
  entitaetsId: string; name: string; stadt: string
  strasse: string; plz: string
  breite: number | null; laenge: number | null
}

const roh = await Bun.file(DATEI).text()
const zeilen = roh.replace(/^﻿/, '').split(/\r?\n/).filter(z => z.trim())
const entitaeten: Entitaet[] = zeilen.slice(1).map(z => {
  const f = felder(auspacken(z))
  return {
    entitaetsId: f[0]!, name: f[2]!, strasse: f[3] ?? '', stadt: f[4] ?? '', plz: f[5] ?? '',
    breite: koordinate(f[9] ?? ''), laenge: koordinate(f[10] ?? ''),
  }
})

const pool = new Pool({ connectionString: config.DATABASE_URL })
try {
  const { rows: betriebe } = await pool.query<{ betrieb_key: number; name: string }>(
    `SELECT betrieb_key, name FROM core.betrieb WHERE aktiv ORDER BY betrieb_key`)
  const nachKey = new Map(betriebe.map(b => [b.betrieb_key, b.name]))

  const treffer: { entitaetsId: string; betriebKey: number; yext: string; betrieb: string; art: string; e?: Entitaet }[] = []
  const offen: Entitaet[] = []
  const belegt = new Set<number>()

  // Von Hand entschiedene Zuordnungen zuerst -- sie sollen den Betrieb
  // belegen, bevor der Namensabgleich ihn sich greift.
  for (const [entitaetsId, betriebKey] of Object.entries(VON_HAND)) {
    if (betriebKey === null) continue
    const e = entitaeten.find(x => x.entitaetsId === entitaetsId)
    if (!e) { log.warn('Zuordnung von Hand zeigt auf eine unbekannte Entitaet', { entitaetsId }); continue }
    const name = nachKey.get(betriebKey)
    if (!name) { log.warn('Zuordnung von Hand zeigt auf einen unbekannten Betrieb', { entitaetsId, betriebKey }); continue }
    belegt.add(betriebKey)
    treffer.push({ entitaetsId, betriebKey, yext: e.name, betrieb: name, art: 'von Hand', e })
  }

  for (const e of entitaeten) {
    if (e.entitaetsId in VON_HAND) continue
    const nE = norm(e.name)
    let b = betriebe.find(x => norm(x.name) === nE && !belegt.has(x.betrieb_key))
    let art = 'Name identisch'
    if (!b) {
      // Deckt den Regelfall ab: LINA fuehrt die Rechtsform mit, Yext nicht.
      b = betriebe.find(x => !belegt.has(x.betrieb_key) &&
        (norm(x.name).includes(nE) || nE.includes(norm(x.name))))
      art = 'Name enthaelt'
    }
    if (b) { belegt.add(b.betrieb_key); treffer.push({ entitaetsId: e.entitaetsId, betriebKey: b.betrieb_key, yext: e.name, betrieb: b.name, art, e }) }
    else offen.push(e)
  }

  for (const t of treffer) {
    const genau = norm(t.yext) === norm(t.betrieb)
    console.log(`${genau ? '  ' : '~ '}${t.entitaetsId.padEnd(7)} ${t.yext.padEnd(36)} -> [${String(t.betriebKey).padStart(3)}] ${t.betrieb}`)
  }

  if (offen.length) {
    console.log(`\nOHNE ZUORDNUNG (${offen.length}) -- gehoeren nach VON_HAND in dieser Datei:`)
    for (const e of offen) console.log(`  ${e.entitaetsId.padEnd(7)} ${e.name.padEnd(36)} ${e.stadt}`)
  }

  // Standorte: nur, was ein vollstaendiges Koordinatenpaar hat. Die
  // Tabelle laesst ein halbes Paar ohnehin nicht zu, und eine Adresse
  // ohne Punkt hilft der Karte nicht.
  const mitGeo = treffer.filter(t => t.e && t.e.breite !== null && t.e.laenge !== null)
  const ohneGeo = treffer.filter(t => !mitGeo.includes(t))
  if (ohneGeo.length) {
    console.log(`\nOHNE KOORDINATEN (${ohneGeo.length}):`)
    for (const t of ohneGeo) console.log(`  ${t.entitaetsId.padEnd(7)} ${t.yext}`)
  }

  console.log(`\n${entitaeten.length} Entitaeten, ${treffer.length} zugeordnet, ${offen.length} offen, ${mitGeo.length} mit Koordinaten`)

  if (!SCHREIBEN) {
    console.log('\nNichts geschrieben. Mit --schreiben uebernehmen.')
  } else {
    const r = await pool.query(
      `INSERT INTO manual.betrieb_fremd_id (betrieb_key, system, fremd_id)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[])
       ON CONFLICT (betrieb_key, system) DO UPDATE SET fremd_id = EXCLUDED.fremd_id`,
      [treffer.map(t => t.betriebKey), treffer.map(() => 'yext'), treffer.map(t => t.entitaetsId)])
    console.log(`\n${r.rowCount} Zeilen in manual.betrieb_fremd_id geschrieben.`)

    // herkunft 'concept_family': die Daten kommen aus dem Yext-Konto der
    // Family & Friends Marketing, nicht aus LINA und nicht aus einem
    // Geocoder von uns. genauigkeit 'adresse', weil Yext auf die
    // Hausnummer geokodiert -- erkennbar an sechs Nachkommastellen.
    const s = await pool.query(
      `INSERT INTO manual.betrieb_standort
         (betrieb_key, strasse, plz, ort, breitengrad, laengengrad, herkunft, genauigkeit, notiz)
       SELECT *, 'concept_family', 'adresse', 'Yext-Entitaetsexport'
         FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[])
       ON CONFLICT (betrieb_key) DO UPDATE SET
         strasse = EXCLUDED.strasse, plz = EXCLUDED.plz, ort = EXCLUDED.ort,
         breitengrad = EXCLUDED.breitengrad, laengengrad = EXCLUDED.laengengrad,
         herkunft = EXCLUDED.herkunft, genauigkeit = EXCLUDED.genauigkeit,
         notiz = EXCLUDED.notiz, geaendert_am = now()`,
      [mitGeo.map(t => t.betriebKey), mitGeo.map(t => t.e!.strasse || null),
       mitGeo.map(t => t.e!.plz || null), mitGeo.map(t => t.e!.stadt || null),
       mitGeo.map(t => t.e!.breite), mitGeo.map(t => t.e!.laenge)])
    console.log(`${s.rowCount} Zeilen in manual.betrieb_standort geschrieben.`)
  }
} finally {
  await pool.end()
}
