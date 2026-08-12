/**
 * Traegt die OM-Einschaetzungen aus dem Round-Table-Excel nach.
 *
 *     bun run src/om_aus_excel.ts               nur anzeigen
 *     bun run src/om_aus_excel.ts --schreiben   uebernehmen
 *
 * EINMALIGE UEBERNAHME. Kuenftig pflegen die Operations Manager ihre
 * Einschaetzung selbst ueber eine Eingabemaske; dieses Skript ist die
 * Bruecke dorthin und die Herkunftsangabe fuer die Altdaten.
 *
 * WARUM DIE KENNZAHL WICHTIG IST: Sie ist die einzige im Round Table, die
 * nicht aus LINA kommt. Die fuenf anderen beschreiben Geld. Ein Betrieb kann
 * wirtschaftlich sauber dastehen und trotzdem verwahrlost sein -- das
 * sieht keine BWA. Im Juli-Excel widerspricht sie den Finanzampeln
 * regelmaessig: bei einem Board mit 20 von 22 roten Betrieben gab es eine
 * 5 und drei 4er.
 *
 * ZUR ZUORDNUNG: Das Excel fuehrt die Betriebe anonymisiert ("Betrieb 01")
 * und nennt nur die Stadt. Die Zuordnung laeuft deshalb ueber die Stadt
 * und wurde am Umsatz gegengeprueft -- 13 der 22 stimmen auf den Cent mit
 * unserem Juni 2026 ueberein. Die Liste unten ist das Ergebnis dieser
 * Pruefung, nicht eine Vermutung.
 *
 * ZUM MONAT: Die Datei heisst "JULI", berichtet aber den Juni. Erkennbar
 * am Umsatz -- Koeln steht mit 165.950,87 EUR drin, exakt unser Juni-Wert
 * fuer COYACAN. Das ist der bekannte Versatz: die Runde tagt im Juli ueber
 * die Zahlen des Vormonats. Die Einschaetzung wird deshalb auf den Juni
 * gebucht, damit sie in mart.round_table_monat neben den Zahlen steht,
 * die im selben Blatt daneben standen.
 */
import { Pool } from 'pg'
import { config } from './config'

const SCHREIBEN = process.argv.includes('--schreiben')
const MONAT = '2026-06-01'
const QUELLE = 'JULI_Round_Table_Ampelsystem.xlsx, Blatt Eingabe'

/**
 * Stadt aus dem Excel -> betrieb_key, mit dem Ergebnis der Umsatzprobe.
 *
 * 'exakt'   Umsatz stimmt auf den Euro mit unserem Juni ueberein.
 * 'geprueft' Zuordnung eindeutig, Umsatz weicht ab -- siehe Kommentar.
 */
const ZUORDNUNG: { stadt: string; betriebKey: number; om: number; probe: string }[] = [
  { stadt: 'Aalen',         betriebKey: 36, om: 2, probe: 'exakt' },
  { stadt: 'Augsburg',      betriebKey: 38, om: 1, probe: 'exakt' },
  { stadt: 'Freudenstadt',  betriebKey: 43, om: 3, probe: 'exakt' },
  { stadt: 'Hamm',          betriebKey: 44, om: 1, probe: 'exakt' },
  { stadt: 'Hannover',      betriebKey: 45, om: 5, probe: 'exakt' },
  { stadt: 'Heilbronn',     betriebKey: 46, om: 4, probe: 'exakt' },
  { stadt: 'Karlsruhe',     betriebKey: 47, om: 2, probe: 'exakt' },
  { stadt: 'Kempten',       betriebKey: 48, om: 4, probe: 'exakt' },
  { stadt: 'Marburg',       betriebKey: 52, om: 3, probe: 'exakt' },
  { stadt: 'Münster',       betriebKey: 54, om: 3, probe: 'exakt' },
  { stadt: 'Nürnberg',      betriebKey: 55, om: 3, probe: 'exakt' },
  { stadt: 'Ulm',           betriebKey: 58, om: 3, probe: 'exakt' },
  { stadt: 'Würzburg',      betriebKey: 60, om: 3, probe: 'exakt' },

  // Der Laden heisst in LINA nach der Betreibergesellschaft. Bestaetigt
  // ueber den Umsatz: 165.950,87 EUR im Juni, identisch mit dem Excel.
  { stadt: 'Köln',          betriebKey: 32, om: 4, probe: 'exakt' },

  // In LINA inzwischen als geschlossen gefuehrt, im Berichtsmonat aber in
  // Betrieb (133.815 EUR im Excel). Einziger Enchilada-Betrieb in Dresden.
  { stadt: 'Dresden',       betriebKey: 80, om: 3, probe: 'geprueft' },

  // Umsatz weicht ab, Zuordnung dennoch eindeutig (je genau ein
  // Enchilada-Betrieb in der Stadt). Die Abweichung ist ein eigener
  // Befund und beruehrt die OM-Note nicht -- siehe unten.
  { stadt: 'Aschaffenburg', betriebKey: 37, om: 3, probe: 'geprueft' },
  { stadt: 'Bayreuth',      betriebKey: 39, om: 3, probe: 'geprueft' },
  { stadt: 'Freiburg',      betriebKey: 42, om: 3, probe: 'geprueft' },
  { stadt: 'Leipzig',       betriebKey: 49, om: 3, probe: 'geprueft' },
  { stadt: 'Minden',        betriebKey: 53, om: 3, probe: 'geprueft' },
  { stadt: 'Rosenheim',     betriebKey: 56, om: 2, probe: 'geprueft' },
  { stadt: 'Bremen',        betriebKey: 41, om: 4, probe: 'geprueft' },
]

const pool = new Pool({ connectionString: config.DATABASE_URL })
try {
  const { rows: bekannt } = await pool.query<{ betrieb_key: number; name: string }>(
    `SELECT betrieb_key, name FROM core.betrieb WHERE betrieb_key = ANY($1::int[])`,
    [ZUORDNUNG.map(z => z.betriebKey)])
  const nameVon = new Map(bekannt.map(b => [b.betrieb_key, b.name]))

  const fehlend = ZUORDNUNG.filter(z => !nameVon.has(z.betriebKey))
  if (fehlend.length) {
    console.error('Diese betrieb_key gibt es nicht:', fehlend.map(f => `${f.stadt}=${f.betriebKey}`).join(', '))
    process.exit(1)
  }

  console.log(`OM-Einschaetzungen aus dem Round Table, gebucht auf ${MONAT}\n`)
  for (const z of ZUORDNUNG) {
    const ampel = z.om >= 4 ? '🟢' : z.om >= 3 ? '🟠' : '🔴'
    console.log(`  ${ampel} ${String(z.om)}  ${z.stadt.padEnd(15)} [${String(z.betriebKey).padStart(3)}] ${nameVon.get(z.betriebKey)!.padEnd(32)} ${z.probe}`)
  }

  const verteilung = [1, 2, 3, 4, 5].map(n => `${n}: ${ZUORDNUNG.filter(z => z.om === n).length}`).join('  ')
  console.log(`\n${ZUORDNUNG.length} Einschaetzungen — Verteilung  ${verteilung}`)

  if (!SCHREIBEN) {
    console.log('\nNichts geschrieben. Mit --schreiben uebernehmen.')
  } else {
    const r = await pool.query(
      `INSERT INTO manual.om_einschaetzung (betrieb_key, monat, om_score, erfasst_von, notiz)
       SELECT * FROM unnest($1::int[], $2::date[], $3::smallint[], $4::text[], $5::text[])
       ON CONFLICT (betrieb_key, monat) DO UPDATE SET
         om_score = EXCLUDED.om_score, erfasst_von = EXCLUDED.erfasst_von,
         notiz = EXCLUDED.notiz, erfasst_am = now()`,
      [ZUORDNUNG.map(z => z.betriebKey), ZUORDNUNG.map(() => MONAT),
       ZUORDNUNG.map(z => z.om), ZUORDNUNG.map(() => 'Operations Manager (Altdaten)'),
       ZUORDNUNG.map(z => `${QUELLE}; Zuordnung ueber Stadt "${z.stadt}", Umsatzprobe ${z.probe}`)])
    console.log(`\n${r.rowCount} Zeilen in manual.om_einschaetzung geschrieben.`)
  }
} finally {
  await pool.end()
}
