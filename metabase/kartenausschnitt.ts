// =====================================================================
// Passt der feste Kartenausschnitt noch zu den Daten?
//
// Der Anlass: Metabase waehlt den Ausschnitt einer Punktkarte selbst und
// trifft daneben -- nachgemessen am 27.07.2026 lagen 2 der 48 Marker
// ausserhalb des Bildes. Man sieht 46 Punkte, die Karte sieht vollstaendig
// aus, und dass zwei fehlen, faellt niemandem auf.
//
// Deshalb steht der Ausschnitt in karten-standort.ts fest. Ein fester Wert
// hat aber die eigene Schwaeche: er veraltet stillschweigend. Kommt ein
// Betrieb in Hamburg oder Wien dazu, liegt er ausserhalb des Rahmens --
// und der Fehler sieht wieder aus wie "den gibt es nicht".
//
// Dieses Skript rechnet nach: umschliessendes Rechteck aller Standorte
// gegen den eingestellten Ausschnitt. Es aendert nichts, es sagt nur, ob
// nachgezogen werden muss.
//
//   bun run metabase/kartenausschnitt.ts
// =====================================================================

import { SQL } from 'bun'

const db = new SQL(process.env.DATABASE_URL!)

// Muss mit AUSSCHNITT in karten-standort.ts uebereinstimmen.
const MITTE_BREITE = 50.4018
const MITTE_LAENGE = 10.2562
const ZOOM = 6

// Wie viel Grad bei diesem Zoom ins Bild passen. Abgelesen an der
// gerenderten Karte (651 x 688 Pixel auf der Standortseite), nicht
// hergeleitet -- die Kachelgroesse haengt am Layout, und ein
// hergeleiteter Wert waere genauer, als die Messung hergibt.
const SICHTBAR_BREITE = 5.6   // Grad noerdlich/suedlich gesamt
const SICHTBAR_LAENGE = 9.0   // Grad oestlich/westlich gesamt

const [r] = await db`
  SELECT min(breitengrad)::float  AS breite_min,
         max(breitengrad)::float  AS breite_max,
         min(laengengrad)::float  AS laenge_min,
         max(laengengrad)::float  AS laenge_max,
         count(*)::int            AS anzahl
    FROM manual.betrieb_standort
   WHERE breitengrad IS NOT NULL`

const rahmen = {
  breite_min: MITTE_BREITE - SICHTBAR_BREITE / 2,
  breite_max: MITTE_BREITE + SICHTBAR_BREITE / 2,
  laenge_min: MITTE_LAENGE - SICHTBAR_LAENGE / 2,
  laenge_max: MITTE_LAENGE + SICHTBAR_LAENGE / 2,
}

console.log(`${r.anzahl} Standorte mit Koordinaten`)
console.log(`  Daten:     Breite ${r.breite_min.toFixed(2)}–${r.breite_max.toFixed(2)}`
          + `   Länge ${r.laenge_min.toFixed(2)}–${r.laenge_max.toFixed(2)}`)
console.log(`  Ausschnitt: Breite ${rahmen.breite_min.toFixed(2)}–${rahmen.breite_max.toFixed(2)}`
          + `   Länge ${rahmen.laenge_min.toFixed(2)}–${rahmen.laenge_max.toFixed(2)}`)

// Wer liegt draussen? Die Namen sind wichtiger als die Zahl -- mit ihnen
// laesst sich pruefen, ob die Koordinate falsch ist oder der Rahmen.
const draussen = await db`
  SELECT b.name AS betrieb, s.breitengrad::float AS breite, s.laengengrad::float AS laenge
    FROM manual.betrieb_standort s
    JOIN core.betrieb b ON b.betrieb_key = s.betrieb_key
   WHERE s.breitengrad IS NOT NULL
     AND (s.breitengrad < ${rahmen.breite_min} OR s.breitengrad > ${rahmen.breite_max}
       OR s.laengengrad < ${rahmen.laenge_min} OR s.laengengrad > ${rahmen.laenge_max})
   ORDER BY b.name`

if (draussen.length === 0) {
  console.log('\nAlle Standorte liegen im Bild. Nichts zu tun.')
} else {
  console.log(`\n${draussen.length} Standort(e) ausserhalb des Ausschnitts:`)
  for (const d of draussen) {
    console.log(`  ${d.betrieb}  (${d.breite.toFixed(4)}, ${d.laenge.toFixed(4)})`)
  }
  const neueMitteBreite = (r.breite_min + r.breite_max) / 2
  const neueMitteLaenge = (r.laenge_min + r.laenge_max) / 2
  console.log(`\nNeue Mitte waere: ${neueMitteBreite.toFixed(4)}, ${neueMitteLaenge.toFixed(4)}`)
  console.log('AUSSCHNITT in metabase/karten-standort.ts anpassen, dann uebernehmen.')
  console.log('Reicht die Mitte nicht, muss der Zoom eine Stufe kleiner werden.')
}

await db.end()
