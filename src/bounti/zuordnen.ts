/**
 * Ordnet Bounti-Standorte unseren Betrieben zu und schreibt das Ergebnis
 * nach manual.betrieb_fremd_id (system = 'bounti').
 *
 * WARUM DIESE TABELLE UEBERHAUPT — dieselbe Begruendung wie bei Yext, und
 * sie gilt hier genauso: LINA fuehrt die Rechtsform mit ("Enchilada Leipzig
 * GmbH"), die Fachsysteme nicht ("Enchilada Leipzig"), und bei zwei
 * Standorten in einer Stadt trennen sich die Namen voellig. Ein
 * Namensabgleich zur Laufzeit waere jedes Mal ein neues Raten. Einmal
 * entschieden, dauerhaft hinterlegt.
 *
 * WAS HIER ANDERS IST ALS BEI YEXT. Yext hat einen Ordnerbaum, in dem
 * fremde Kunden derselben Agentur stehen — dort muss zuerst gefiltert
 * werden, wem ein Standort ueberhaupt gehoert. Bounti ist der eigene
 * Mandant der Concept Family; hier ist die Frage nicht "gehoert er uns",
 * sondern nur "welcher Betrieb ist es".
 *
 * ES WIRD NICHT GERATEN. Geschrieben wird ausschliesslich, was eindeutig
 * ist: genau ein Betrieb passt, und der Betrieb ist noch frei. Alles
 * andere bleibt offen und steht in mart.bounti_ohne_betrieb — sichtbar,
 * mit Namen, als Arbeitsliste. Ein falsch zugeordneter Standort ist
 * teurer als ein fehlender: er traegt seine Schulungszahlen in einen
 * fremden Betrieb, und niemand sieht es der Zahl an.
 */
import { query } from '../db/pool'
import { log } from '../lib/log'
import { standorteHolen, bountiKonfiguriert, type BStandort } from './client'

/**
 * Zuordnungen, die ein Mensch entschieden hat.
 *
 * Am 24.08.2026 nach dem ersten echten Abgleich gefuellt: sieben
 * Zuordnungen und zehn ausdrueckliche Offenlassungen. Was der Automat nicht
 * eindeutig trifft, gehoert HIERHIN und nicht in eine schaerfere Heuristik:
 * eine Regel, die die heutigen Sonderfaelle trifft, trifft naechstes Jahr
 * die falschen (siehe src/yext/zuordnen.ts, wo dieselbe Liste 13 Eintraege
 * hat).
 *
 * `null` heisst AUSDRUECKLICH OFFEN und ist etwas anderes als ein
 * fehlender Eintrag: der Automat laesst den Standort dann in Ruhe, statt
 * ihm den naechstbesten Namen zuzuweisen.
 */
export const VON_HAND: Record<string, number | null> = {
  // --- Entschieden am 24.08.2026, nach dem ersten echten Abgleich ---------
  //
  // KEINE DAVON IST GERATEN. Jede Zuordnung unten ist dieselbe Entscheidung,
  // die Eugene fuer YEXT schon einmal getroffen hat — nachpruefbar in
  // manual.betrieb_fremd_id (system = 'yext') und in src/yext/zuordnen.ts.
  // Bounti und Yext tragen beide den Marketingnamen, LINA den
  // Gesellschaftsnamen; wo die Bruecke fuer Yext steht, gilt sie hier auch.
  // Die Yext-Entitaet steht jeweils als Beleg dabei.

  clrc0p5xb0091nyg1qx3jiyir: 4,    // Alter Kranen (Wuerzburg) -> [4] Alter Kranen GmbH        (yext EK_04)
  clrc12e2q00a3nyg1czbhhmc8: 32,   // Enchilada Koeln (Coyacan) -> [32] COYACAN GmbH           (yext E_33)
  clrc12lnf00a5eb9qqt1yrnax: 106,  // Lehners Heilbronn -> [106] Lehners HN Gaststaetten GmbH  (yext L_01)
  clrc1380i00a9nyg1ehi5isqr: 108,  // Lehners Rastatt -> [108] Lehners Wirtshaus Rastatt GmbH  (yext L_04)
  clrc13hfv00abnyg1vwz6jyw7: 65,   // Wilma Wunder am Markt Mainz -> [65] Gastronomie am Markt Mainz GmbH (yext W_05)
  pw2pvw36u1lgpqd93qumxu29: 18,    // Aposto Wuppertal Alte Papierfabrik -> [18] Aposto Wuppertal - Alter Papierfabrik (yext A_15)
  //
  // Mehrdeutig fuer den Automaten, entschieden ueber dieselbe Yext-Bruecke:
  // "Wilma Wunder Ballplatz Mainz" passt auf [105] KUZ - … und [123] … GmbH.
  // Yext W_01 zeigt auf 123, und dabei bleibt es.
  clrc14c3t00a9eb9q7uxnjuqe: 123,  // (yext W_01)

  // --- AUSDRUECKLICH OFFEN ------------------------------------------------
  //
  // `null` heisst: der Automat laesst den Standort in Ruhe. Etwas anderes
  // als ein fehlender Eintrag — hier steht, dass die Frage GESTELLT und
  // nicht vergessen wurde.
  //
  // Die ersten fuenf sind dieselben Faelle, die auch bei Yext offen sind
  // (src/yext/zuordnen.ts). Wo dort seit dem 03.08.2026 ein Verdacht steht,
  // steht er hier auch — ein Verdacht ist keine Zuordnung.
  clrc0owv2008znyg16k2j99l3: null, // Besitos Wuerzburg — in LINA gibt es keinen (yext B_04 offen)
  clrc0pk230093nyg14ep3hulm: null, // Carls Brauhaus Stuttgart — evtl. [138] Wirtshaus am Schlossplatz (yext EK_06 offen)
  clrc0qiu90097nyg1utl60hhy: null, // Riegele Augsburg — kein plausibler Betrieb (yext EK_11 offen)
  ni11x0c5dw4vfndg87f6vvcq: null,  // Wuerzburger Hofbraeukeller — evtl. [122] WHK Gastronomie (yext EK_14 offen)
  clrc1324c00a7nyg106cqhlu5: null, // Lehners Pforzheim — evtl. [21] B+L Pforzheim (yext L_03 offen)
  //
  // Drei Standorte tragen den Namen "Schlager Cafe" in LINA ([116] Beteiligungs AG,
  // [117] Duesseldorf GmbH, [118] Franchise AG). Yext kennt genau eine Entitaet
  // (SC_01 -> 117). Dass Bountis "Schlager Cafe" derselbe Betrieb ist, ist
  // WAHRSCHEINLICH und nicht gemessen — deshalb offen, nicht 117.
  vpoqscnyam8t9u7aa5mzvea7: null,  // Schlager Cafe
  //
  // Kein Betrieb, sondern Verwaltung und Technik. Ohne diese Zeilen wuerde
  // "Concept Family" auf "A Testladen Concept Family" treffen — ein Treffer,
  // der wie ein Erfolg aussieht und keiner ist (dieselbe Falle wie bei Yext
  // mit der Zentrale in Graefelfing).
  b6oxv19jq366cpetxca761h0: null,  // LINA TEST
  clt7b9y7202mrmzlows0pxa9m: null, // Concept Family
  lqt24tjcqebf1qawt0o9ev0l: null,  // Concept Family Intern
  hcjycfw4913rbx6uxkg6gxf8: null,  // Ops Enchilada
}

/**
 * Vergleichsform: Kleinbuchstaben, Umlaute aufgeloest, nur Buchstaben und
 * Ziffern.
 *
 * WORTGLEICH MIT src/yext/zuordnen.ts, absichtlich kopiert und nicht
 * geteilt: die beiden duerfen sich unabhaengig voneinander aendern, wenn
 * ein System seine Schreibweise aendert. Die Falle, die dort am 03.08.2026
 * Geld gekostet hat, gilt hier genauso — Umlaute muessen ZWEISTELLIG
 * gefaltet werden (ue), Akzente EINSTELLIG (e), sonst wird aus
 * "Park Café München" die Form "parkcafmuenchen" und trifft nichts mehr.
 */
const norm = (s: string) => (s ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '')

export type Treffer = {
  standortId: string
  betriebKey: number
  standort: string
  betrieb: string
  art: string
}

export type Zuordnungsbericht = {
  standorte: number
  zugeordnet: number
  offen: number
  geschrieben: number
  mehrdeutig: { id: string; name: string; kandidaten: string[] }[]
  offene_namen: { id: string; name: string }[]
  treffer: Treffer[]
}

export type Betrieb = { betrieb_key: number; name: string }

/**
 * Die Rechnung, ohne Datenbank und ohne Netz.
 *
 * EIGENE FUNKTION, DAMIT SIE PRUEFBAR IST. Der Namensabgleich ist die
 * Stelle, an der diese Anbindung still das Falsche tun kann — ein Standort
 * am falschen Betrieb traegt seine Schulungszahlen in ein fremdes Haus, und
 * niemand sieht es der Zahl an. Solche Logik gehoert in eine Funktion, die
 * ein Test mit erfundenen Namen durchspielen kann, statt in eine, die dafuer
 * eine Datenbank braucht.
 *
 * `belegt` sind Betriebe, die schon einem ANDEREN Bounti-Standort gehoeren.
 * Ohne sie griffe ein zweiter aehnlicher Name denselben Betrieb noch einmal —
 * und weil manual.betrieb_fremd_id auf (betrieb_key, system) schluesselt,
 * ueberschriebe der zweite den ersten still.
 */
export function zuordnungRechnen(
  standorte: BStandort[], betriebe: Betrieb[], belegt: Set<number> = new Set(),
  /*
   * WAS BEREITS IN DER DATENBANK STEHT: Standort-ID -> Betrieb.
   *
   * Ohne diesen Parameter zerfaellt der Abgleich beim ZWEITEN Lauf. Am
   * 24.08.2026 vorgefuehrt: erster Lauf 62 zugeordnet, zweiter Lauf 7. Der
   * Grund ist der Schutz gegen Doppelvergabe eine Zeile tiefer — ein
   * Betrieb, der schon einem Bounti-Standort gehoert, gilt als belegt und
   * faellt aus der Kandidatenliste. Beim zweiten Lauf gilt das eben auch
   * fuer SEINEN EIGENEN Standort, und der findet dann nichts mehr.
   *
   * Der Schaden waere kein falscher Schreibvorgang, sondern eine falsche
   * Meldung: der naechtliche Lauf haette "offen: 81" protokolliert, wo
   * nichts offen ist. Eine Zahl, die grundlos Alarm schlaegt, wird
   * abgeschaltet — und nimmt die echten Faelle mit.
   */
  bestehend: Map<string, number> = new Map(),
  /*
   * Die Handliste als Parameter und nicht als fest verdrahtete Konstante.
   * Grund: sie waechst mit jeder Entscheidung, und ein Test, der die
   * Gesamtzahl offener Standorte prueft, waere sonst bei jeder neuen Zeile
   * rot geworden — ohne dass am Abgleich etwas kaputt ist. Ein Test, der
   * aus fremdem Grund ausschlaegt, wird abgeschaltet.
   */
  vonHand: Record<string, number | null> = VON_HAND,
): Omit<Zuordnungsbericht, 'geschrieben'> {
  const nachKey = new Map(betriebe.map(b => [b.betrieb_key, b.name]))
  const genommen = new Set(belegt)
  const treffer: Treffer[] = []
  const offen: BStandort[] = []
  const mehrdeutig: { id: string; name: string; kandidaten: string[] }[] = []

  // Von Hand entschiedene Zuordnungen zuerst — sie sollen den Betrieb
  // belegen, bevor der Namensabgleich ihn sich greift.
  for (const [standortId, betriebKey] of Object.entries(vonHand)) {
    if (betriebKey === null) continue
    const s = standorte.find(x => x.id === standortId)
    if (!s) { log.warn('Zuordnung von Hand zeigt auf einen unbekannten Standort', { standortId }); continue }
    const name = nachKey.get(betriebKey)
    if (!name) { log.warn('Zuordnung von Hand zeigt auf einen unbekannten Betrieb', { standortId, betriebKey }); continue }
    genommen.add(betriebKey)
    treffer.push({ standortId, betriebKey, standort: s.name, betrieb: name, art: 'von Hand' })
  }

  for (const s of standorte) {
    if (s.id in vonHand) continue

    /*
     * Schon zugeordnet? Dann ist das ein Treffer und keine offene Frage —
     * unabhaengig davon, ob der Name heute noch passt. Die Entscheidung
     * steht in manual.betrieb_fremd_id und wird hier nicht neu verhandelt.
     */
    const schon = bestehend.get(s.id)
    if (schon !== undefined && nachKey.has(schon)) {
      genommen.add(schon)
      treffer.push({ standortId: s.id, betriebKey: schon, standort: s.name,
                     betrieb: nachKey.get(schon)!, art: 'bereits zugeordnet' })
      continue
    }

    const n = norm(s.name)
    if (!n) { offen.push(s); continue }

    const frei = betriebe.filter(b => !genommen.has(b.betrieb_key))
    let art = 'Name identisch'
    let kandidaten = frei.filter(b => norm(b.name) === n)
    if (kandidaten.length === 0) {
      // Der Regelfall: LINA fuehrt die Rechtsform mit, Bounti nicht.
      art = 'Name enthaelt'
      kandidaten = frei.filter(b => norm(b.name).includes(n) || n.includes(norm(b.name)))
    }

    if (kandidaten.length === 1) {
      const b = kandidaten[0]!
      genommen.add(b.betrieb_key)
      treffer.push({ standortId: s.id, betriebKey: b.betrieb_key,
                     standort: s.name, betrieb: b.name, art })
    } else if (kandidaten.length > 1) {
      /*
       * MEHRDEUTIG WIRD NICHT ENTSCHIEDEN. "Aposto Mainz" trifft
       * "Aposto Mainz GmbH" und "Aposto Mainz Ballplatz" gleich gut;
       * welcher gemeint ist, weiss der Name nicht. Diese Faelle gehoeren
       * in VON_HAND, nachdem ein Mensch hingesehen hat.
       */
      mehrdeutig.push({ id: s.id, name: s.name, kandidaten: kandidaten.map(k => k.name) })
      offen.push(s)
    } else offen.push(s)
  }

  const ausdruecklichOffen = Object.entries(vonHand)
    .filter(([, v]) => v === null).map(([k]) => k)

  return {
    standorte: standorte.length,
    zugeordnet: treffer.length,
    offen: offen.length + ausdruecklichOffen.length,
    mehrdeutig,
    offene_namen: [
      ...offen.map(s => ({ id: s.id, name: s.name })),
      ...ausdruecklichOffen.map(id => ({
        id, name: standorte.find(s => s.id === id)?.name ?? '',
      })),
    ],
    treffer,
  }
}

/**
 * Der Abgleich gegen Datenbank und Schnittstelle. Die Rechnung selbst steht
 * in `zuordnungRechnen()` darueber — hier wird nur geholt und geschrieben.
 *
 * `schreiben: false` rechnet nur; dieselbe Rechnung, damit die Vorschau
 * nicht von der Uebernahme abweichen kann.
 *
 * WIRFT. Der Aufrufer in nachlauf.ts faengt alles ab; in der Vorschau im
 * Terminal ist ein Fehler einer, den man sehen will.
 */
export async function zuordnungAbgleichen(
  opt: { schreiben?: boolean; standorte?: BStandort[] } = {},
): Promise<Zuordnungsbericht> {
  if (!opt.standorte && !bountiKonfiguriert()) {
    throw new Error('BOUNTI_API_TOKEN ist nicht gesetzt')
  }
  const standorte = opt.standorte ?? await standorteHolen()

  const betriebe = await query<Betrieb>(
    `SELECT betrieb_key, name FROM core.betrieb WHERE aktiv ORDER BY betrieb_key`)

  const vorhanden = await query<{ betrieb_key: number; fremd_id: string }>(
    `SELECT betrieb_key, fremd_id FROM manual.betrieb_fremd_id WHERE system = 'bounti'`)
  const belegt = new Set(vorhanden.map(z => z.betrieb_key))
  const bestehend = new Map(vorhanden.map(z => [z.fremd_id, z.betrieb_key]))

  const bericht = {
    ...zuordnungRechnen(standorte, betriebe, belegt, bestehend), geschrieben: 0,
  }

  if (!opt.schreiben || bericht.treffer.length === 0) return bericht

  const r = await query(
    `INSERT INTO manual.betrieb_fremd_id (betrieb_key, system, fremd_id)
     SELECT * FROM unnest($1::int[], $2::text[], $3::text[])
     ON CONFLICT (betrieb_key, system) DO UPDATE SET fremd_id = excluded.fremd_id
     RETURNING betrieb_key`,
    [bericht.treffer.map(t => t.betriebKey), bericht.treffer.map(() => 'bounti'),
     bericht.treffer.map(t => t.standortId)])

  return { ...bericht, geschrieben: r.length }
}
