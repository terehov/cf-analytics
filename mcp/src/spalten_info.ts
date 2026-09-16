/**
 * Das Ergebnis so beschreiben, dass ein Modell eine Darstellung waehlen kann.
 *
 * *Eugene, 13.09.2026:* die Modelle sollen selbst entscheiden, wie sie die
 * Daten darstellen — das traut er ihnen mehr zu als einer Festlegung, die
 * vor einem Jahr jemand in eine Karte geschrieben hat. Der Server zeichnet
 * NICHTS: kein SVG, keine Diagrammansicht, keine vorgeschlagene Form. Er
 * liefert Daten und Einordnung; das Modell zeichnet mit seinen eigenen
 * Mitteln, und der Nutzer aendert die Form im Gespraech.
 *
 * DAMIT IST DIE AUFGABE DIESES SERVERS: die Grundlage liefern, auf der man
 * die Form gut entscheiden kann. Ein Modell, das nur Spaltennamen und Zahlen sieht, raet: es haelt
 * `monat` fuer eine Kategorie, `we_kueche_pct` fuer Euro und `betrieb_key`
 * fuer eine Kennzahl, die man summieren koennte.
 *
 * Deshalb bekommt es je Spalte:
 *
 *   rolle       zeit / merkmal / kennzahl / ampel / schluessel
 *   einheit     euro, prozentzahl, anzahl, note, tage — aus mcp.kennzahl
 *   verschieden wie viele verschiedene Werte (12 Monate oder 141 Betriebe
 *               ist der Unterschied zwischen Linie und liegendem Balken)
 *   spanne      min/max bei Zahlen — zwei Groessenordnungen in einem
 *               Diagramm sind der haeufigste Diagrammfehler ueberhaupt
 *
 * Das ist derselbe Gedanke wie beim Befund-Anhang: was ein Modell wissen
 * muss, reist mit der Antwort mit, statt darauf zu hoffen, dass es
 * nachfragt.
 */
import type { Katalog } from './katalog'

export type Rolle = 'zeit' | 'merkmal' | 'kennzahl' | 'ampel' | 'schluessel'

export type SpalteInfo = {
  spalte: string
  rolle: Rolle
  einheit?: string | null
  verschieden: number
  spanne?: [number, number]
  beispiele?: string[]
  hinweis?: string
}

/**
 * Woerter aus mart.round_table_monat (rot, orange, gruen, unvollstaendig),
 * Emojis aus ampel.beschriftung (🔴 🟠 🟢) und das ⚪, das die Karten
 * (metabase/karten-drilldown.ts) fuer "keine Ampel berechenbar" setzen.
 * Ohne die Emojis galten die Ampelspalten der fertigen Berichte ("●",
 * "◐ Umsatz") als Merkmal — dem Modell fehlte die Zaehl-statt-mitteln-Regel,
 * und das Ampelraster (views/round-table.tsx) faerbte nichts.
 */
const AMPELWERTE = new Set([
  'rot', 'orange', 'gruen', 'grün', 'grau', 'gelb', 'unvollstaendig',
  '🔴', '🟠', '🟡', '🟢', '⚪',
])

const zahl = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  // numeric kommt als Text aus pg — bewusst, damit beim Runden nichts verloren
  // geht (src/db.ts). Fuer die Profilierung wird hier gelesen, nicht gerechnet.
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

const istDatum = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(v)

export function spaltenBeschreiben(
  spalten: string[], zeilen: Record<string, unknown>[], katalog: Katalog, sichten: string[],
): SpalteInfo[] {
  // Kennzahlregeln der beteiligten Sichten: sie sagen die Einheit.
  const einheiten = new Map<string, string | null>()
  for (const s of sichten) {
    for (const k of katalog.sichten.get(s)?.kennzahlen ?? []) einheiten.set(k.spalte, k.einheit)
  }

  return spalten.map(spalte => {
    const werte = zeilen.map(z => z[spalte]).filter(v => v !== null && v !== undefined)
    const verschiedene = new Set(werte.map(v => String(v)))
    const zahlen = werte.map(zahl).filter((n): n is number => n !== null)
    const alleZahlen = werte.length > 0 && zahlen.length === werte.length
    const einheit = einheiten.get(spalte) ?? null

    let rolle: Rolle
    let hinweis: string | undefined

    /**
     * DER KATALOG GEHT VOR DER DATENPROBE. Eine Spalte mit hinterlegter
     * Einheit ist eine Kennzahl, auch wenn gerade keine Zeile da ist —
     * gefunden an einer leeren Antwort, in der `umsatz_netto` (euro) als
     * Merkmal zum Gruppieren angeboten wurde.
     */
    const einheitKennzahl = einheit !== null && einheit !== 'text'

    if (spalte.endsWith('_key')) {
      rolle = 'schluessel'
      hinweis = 'Ein Schluessel. Nicht als Kennzahl darstellen — er ist eine Kennung, keine Menge.'
    } else if (katalog.achsen.get(spalte)?.art === 'zeit' || werte.every(istDatum) && werte.length > 0) {
      rolle = 'zeit'
    } else if (verschiedene.size > 0 && [...verschiedene].every(v => AMPELWERTE.has(v.toLowerCase()))) {
      rolle = 'ampel'
      hinweis = 'Eine Ampel. Feste Statusfarben, nie eine Serienfarbe — und nie mitteln, nur zaehlen.'
    } else if (einheitKennzahl || (alleZahlen && einheit !== 'text')) {
      rolle = 'kennzahl'
      if (einheit === 'prozentzahl') {
        hinweis = 'Schon Prozent (23.64), kein Bruch. Achse in %, NICHT mit 100 multiplizieren.'
      }
    } else {
      rolle = 'merkmal'
    }

    const info: SpalteInfo = { spalte, rolle, verschieden: verschiedene.size }
    if (einheit) info.einheit = einheit
    if (rolle === 'kennzahl' && zahlen.length) {
      info.spanne = [Math.min(...zahlen), Math.max(...zahlen)]
    }
    if (rolle === 'merkmal' || rolle === 'ampel') {
      info.beispiele = [...verschiedene].slice(0, 4)
    }
    if (hinweis) info.hinweis = hinweis
    return info
  })
}

/**
 * Der Satz, der dem Modell sagt, dass die Darstellung seine Sache ist.
 *
 * Der Server zeichnet nichts und schlaegt keine Form vor. Er nennt, was ein
 * Modell von sich aus nicht sehen kann — welche Spalte die Zeit ist, welche
 * eine Einheit hat, wo zwei Groessenordnungen aufeinandertreffen — und
 * ueberlaesst ihm den Rest. Der Nutzer aendert die Form im Gespraech
 * („als Balken", „lieber eine Tabelle"); dafuer braucht es keinen zweiten
 * Aufruf, die Daten sind ja da.
 */
export function darstellungshinweis(infos: SpalteInfo[], zeilen: number): string {
  if (zeilen === 0) {
    return 'Keine Zeilen — es gibt nichts darzustellen. Das dem Nutzer sagen, statt ein leeres ' +
      'Diagramm zu zeichnen; meist ist der Zeitraum oder ein Filter zu eng.'
  }
  const kennzahlen = infos.filter(i => i.rolle === 'kennzahl')
  const zeit = infos.find(i => i.rolle === 'zeit')
  const merkmale = infos.filter(i => i.rolle === 'merkmal')
  const ampeln = infos.filter(i => i.rolle === 'ampel')

  const teile = [
    'DIE DARSTELLUNG IST DEINE ENTSCHEIDUNG: waehle die Form, die diese Daten am besten ' +
    'zeigt, und zeichne sie mit deinen eigenen Mitteln — Diagramm, Tabelle oder eine ' +
    'einzelne grosse Zahl. Der Nutzer kann jederzeit eine andere Form verlangen; dafuer die ' +
    'vorliegenden Daten neu darstellen, nicht neu abfragen.',
  ]

  if (zeit) teile.push(`Zeitachse: "${zeit.spalte}" (${zeit.verschieden} Werte).`)
  if (merkmale.length) {
    teile.push('Merkmale zum Gruppieren: ' + merkmale
      .map(m => `"${m.spalte}" (${m.verschieden} verschiedene)`).join(', ') + '.')
  }
  if (kennzahlen.length) {
    teile.push('Kennzahlen: ' + kennzahlen
      .map(k => `"${k.spalte}"${k.einheit ? ` in ${k.einheit}` : ''}`).join(', ') + '.')
  }
  if (ampeln.length) {
    teile.push(`Ampeln (${ampeln.map(a => `"${a.spalte}"`).join(', ')}): rot/orange/gruen als ` +
      'Statusfarben zeigen, zaehlen statt mitteln.')
  }

  // Die drei Dinge, die bei freier Wahl erfahrungsgemaess schiefgehen.
  const groessenordnungen = kennzahlen.filter(k => k.spanne).map(k => Math.abs(k.spanne![1]) || 1)
  if (groessenordnungen.length > 1) {
    const verhaeltnis = Math.max(...groessenordnungen) / Math.min(...groessenordnungen)
    if (verhaeltnis > 50) {
      teile.push(
        `ACHTUNG: die Kennzahlen liegen um Faktor ${Math.round(verhaeltnis)} auseinander. ` +
        `Nicht auf eine Achse und nicht auf zwei Achsen in einem Bild — zwei Darstellungen, ` +
        `oder auf einen gemeinsamen Bezug (Index, Anteil) bringen.`)
    }
  }
  const vieleKategorien = merkmale.find(m => m.verschieden > 12)
  if (vieleKategorien) {
    teile.push(
      `"${vieleKategorien.spalte}" hat ${vieleKategorien.verschieden} Auspraegungen — als Farbserien ` +
      `nicht mehr unterscheidbar; sortiert und liegend, oder auf die groessten zehn begrenzt.`)
  }
  if (zeilen === 1) {
    teile.push('Eine einzige Zeile: eine grosse Kennzahl mit Einheit, kein Diagramm mit einem Balken.')
  }

  return teile.join(' ')
}
