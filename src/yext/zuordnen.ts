/**
 * Ordnet Yext-Entitaeten unseren Betrieben zu und schreibt das Ergebnis
 * nach manual.betrieb_fremd_id (und die Koordinaten nach
 * manual.betrieb_standort).
 *
 * SEIT DEM 14.08.2026 LAEUFT DAS VON SELBST, einmal je Kalendermonat als
 * Teil von `yextNachlauf()`. Vorher war es ausschliesslich ein Handbefehl
 * (`bun run yext:zuordnen --schreiben`) — und damit dieselbe Falle wie
 * ueberall sonst in diesem Projekt: eine Reparatur, die ein Mensch anstossen
 * muss, ist keine Reparatur, sondern eine Verabredung. Ein neu eroeffneter
 * Betrieb waere bis zum naechsten Handlauf ohne Bewertung geblieben, und
 * eine fehlende Bewertung sieht in der Ampel aus wie eine graue Zelle, nicht
 * wie ein Fehler.
 *
 * Das Skript `src/yext_zuordnen.ts` bleibt als lesbare Vorschau daneben:
 *
 *     bun run yext:zuordnen               nur anzeigen (Voreinstellung)
 *     bun run yext:zuordnen --schreiben   uebernehmen
 *
 * QUELLE IST SEIT DEM 03.08.2026 DIE API, NICHT MEHR DER CSV-EXPORT.
 * Der Export in examples/ hatte 48 Zeilen, das Konto fuehrt 66 Entitaeten von
 * uns — 18 Betriebe waren damit unsichtbar, darunter saemtliche Lehners, alle
 * Ratskeller und Besitos Wuerzburg. Ein Export ist ein Standbild; wer ihn als
 * Quelle behaelt, baut den naechsten blinden Fleck schon ein.
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
import { query } from '../db/pool'
import { log } from '../lib/log'
import { entitaetenHolen, ordnerHolen, yextKonfiguriert, type YextEntitaet } from './client'

/**
 * Die Ordner der obersten Ebene, die uns gehoeren.
 *
 * Das Konto der Family & Friends Marketing enthaelt auch fremde Kunden:
 * Gimme Gelato, Pommes Freunde, my Indigo und die Soulkitchen Gruppe — am
 * 03.08.2026 zusammen 43 Standorte, alle unter derselben accountId. Eine
 * technische Trennung gibt es nicht (docs/yext-anbindung.md §1), nur diesen
 * Ordnerbaum.
 *
 * Der Filter steht hier als NAMEN und nicht als Ordner-IDs: eine Nummer sagt
 * beim Lesen nichts, und wenn Yext den Baum umbaut, faellt ein fehlender Name
 * auf, waehrend eine falsche Nummer still das Falsche einsammelt.
 */
const UNSERE_ORDNER = new Set([
  'Aposto', 'Besitos', 'Einzelkonzepte', 'Enchilada', 'Lehners',
  'Wilma Wunder', 'Zentrale',
])

/**
 * Zuordnungen, die ein Mensch entschieden hat.
 *
 * Hier steht alles, was der automatische Abgleich NICHT eindeutig
 * hinbekommt -- zwei Standorte in einer Stadt, abweichende Betriebsnamen,
 * Tippfehler. Bewusst als Liste im Code und nicht als Heuristik: eine
 * Regel, die diese Faelle trifft, traefe naechstes Jahr auch die falschen.
 *
 * `null` heisst AUSDRUECKLICH OFFEN und ist etwas anderes als ein fehlender
 * Eintrag: der Automat laesst die Entitaet dann in Ruhe, statt ihr den
 * naechstbesten Namen zuzuweisen.
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

  // --- 03.08.2026, nachdem die API 18 bis dahin unsichtbare Entitaeten
  // --- zeigte. Alle drei tragen in LINA einen Gesellschaftsnamen, der mit
  // --- dem Betriebsnamen bei Yext kein Wort gemeinsam hat:
  EK_04: 4,     // "Brauerei-Gasthof Alter Kranen" -> "Alter Kranen GmbH"
  L_01: 106,    // "Lehners Wirtshaus Heilbronn"   -> "Lehners HN Gaststaettenbetriebs GmbH" (HN = Heilbronn)
  L_02: 107,    // "Lehners Wirtshaus Karlsruhe"   -> "Lehners Karlsruhe"

  // --- Ausdruecklich offen. Fuenf Entitaeten in unseren Ordnern, zu denen
  // --- in core.betrieb kein Betrieb zweifelsfrei passt. Sie stehen hier,
  // --- damit der Automat sie nicht doch noch irgendwo hinsortiert -- und
  // --- damit sichtbar bleibt, dass die Frage gestellt und nicht vergessen
  // --- wurde. Ohne Zuordnung laedt der Importer sie schlicht nicht.
  B_04: null,   // "Besitos Wuerzburg" -- in LINA existiert kein Besitos Wuerzburg
  EK_06: null,  // "Carls Brauhaus", Stuttgart -- evtl. [138] Wirtshaus am Schlossplatz GmbH
  EK_11: null,  // "Riegele Wirtshaus", Augsburg -- kein plausibler Betrieb gefunden
  EK_14: null,  // "Wuerzburger Hofbraeukeller" -- evtl. [122] WHK Gastronomie GmbH
  L_03: null,   // "Lehners Wirtshaus Pforzheim" -- evtl. [21] B+L Pforzheim GmbH
}

/**
 * Vergleichsform: Kleinbuchstaben, Umlaute aufgeloest, nur Buchstaben und Ziffern.
 *
 * AKZENTE WERDEN GEFALTET, NICHT GELOESCHT. Ohne diesen Schritt wird aus
 * "Park Café München" die Form "parkcafmuenchen" -- das 'é' faellt dem
 * Zeichenfilter zum Opfer, das 'e' fehlt, und der Betrieb "Park Cafe München
 * GmbH" wird nicht mehr getroffen. Am 03.08.2026 genau so passiert.
 *
 * Umlaute muessen ZWEISTELLIG gefaltet werden (ue, nicht u), Akzente
 * EINSTELLIG (e, nicht ee) -- dieselbe Unterscheidung wie in core.name_norm.
 */
const norm = (s: string) => (s ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '')


export type Treffer = {
  entitaetsId: string; betriebKey: number; yext: string; betrieb: string
  art: string; e: YextEntitaet
}

export type Zuordnungsbericht = {
  entitaeten_im_konto: number
  entitaeten_unsere: number
  zugeordnet: number
  offen: number
  mit_koordinaten: number
  geschrieben: number
  /** Entitaeten in unseren Ordnern ohne Betrieb — die Arbeitsliste. */
  offene_namen: { id: string; name: string; ort: string }[]
  /** Die Einzeltreffer. Nur die Vorschau im Terminal liest sie. */
  treffer: Treffer[]
  /** Die Teilmenge mit vollstaendigem Koordinatenpaar. */
  mitGeo: Treffer[]
}

/**
 * Der reine Rechenteil — dieselbe Bauart wie `zuordnungRechnen()` in
 * bounti/zuordnen.ts, und aus demselben Grund herausgeloest: er ist die
 * Stelle, an der ENTSCHIEDEN wird, und eine Entscheidung gehoert geprueft.
 *
 * Bis zum 25.08.2026 steckte diese Rechnung mitten in `zuordnungAbgleichen()`
 * zwischen zwei Schnittstellenaufrufen und einem Schreibvorgang — testbar war
 * sie damit nicht, und genau in diesem Zustand ist sie taeglich geworden.
 *
 * KEIN ZUSTAND, KEINE SEITENWIRKUNG: rein hinein, rein heraus. `bestehend`
 * und `vonHand` sind Parameter und keine Konstanten, damit ein Test beides
 * stellen kann, ohne die echte Handliste anzufassen — sie waechst mit jeder
 * Entscheidung, und ein Test, der aus fremdem Grund ausschlaegt, wird
 * abgeschaltet.
 */
export function zuordnungRechnen(
  entitaeten: YextEntitaet[],
  betriebe: { betrieb_key: number; name: string }[],
  /** fremd_id → betrieb_key, aus manual.betrieb_fremd_id. */
  bestehend: Map<string, number> = new Map(),
  vonHand: Record<string, number | null> = VON_HAND,
): { treffer: Treffer[]; offen: YextEntitaet[]; ausdruecklichOffen: string[] } {
  const nachKey = new Map(betriebe.map(b => [b.betrieb_key, b.name]))

  /**
   * DIE BESTEHENDEN ZUORDNUNGEN — und warum sie hier vorher fehlten.
   *
   * Bis zum 24.08.2026 rechnete dieser Abgleich jedes Mal von vorn: nur
   * `VON_HAND` galt als gesetzt, alles andere entschied die Namensheuristik
   * neu. Geschrieben wurde mit `DO UPDATE`, also **ueberschreibend**.
   *
   * Solange der Abgleich monatlich lief, war das ein seltenes Risiko. Seit
   * er TAEGLICH laeuft, waere es ein taegliches: benennt jemand einen
   * Betrieb in LINA um oder legt Yext eine zweite Entitaet mit aehnlichem
   * Namen an, kippte die Zuordnung ueber Nacht — und niemand haette einen
   * Anlass hinzusehen, weil nichts scheitert.
   *
   * Genau davor warnte der alte Kommentar in nachlauf.ts: "eine
   * Entscheidung, die sich taeglich neu faellt, ist keine". Die Antwort
   * darauf ist nicht, seltener zu entscheiden, sondern **einmal Entschiedenes
   * nicht neu zu verhandeln** — dieselbe Bauart, die bounti/zuordnen.ts seit
   * seinem zweiten Lauf hat (`bereits zugeordnet`).
   */
  const treffer: Treffer[] = []
  const offen: YextEntitaet[] = []
  /*
   * Bereits vergebene Betriebe sind belegt, BEVOR die Heuristik anfaengt.
   * Sonst greift sich der Namensabgleich einen Betrieb, der schon einer
   * anderen Entitaet gehoert, und die Zuordnung wandert.
   */
  const belegt = new Set<number>(bestehend.values())

  // Von Hand entschiedene Zuordnungen zuerst -- sie sollen den Betrieb
  // belegen, bevor der Namensabgleich ihn sich greift.
  for (const [entitaetsId, betriebKey] of Object.entries(vonHand)) {
    if (betriebKey === null) continue
    const e = entitaeten.find(x => x.meta?.id === entitaetsId)
    if (!e) { log.warn('Zuordnung von Hand zeigt auf eine unbekannte Entitaet', { entitaetsId }); continue }
    const name = nachKey.get(betriebKey)
    if (!name) { log.warn('Zuordnung von Hand zeigt auf einen unbekannten Betrieb', { entitaetsId, betriebKey }); continue }
    belegt.add(betriebKey)
    treffer.push({ entitaetsId, betriebKey, yext: e.name ?? '', betrieb: name, art: 'von Hand', e })
  }

  for (const e of entitaeten) {
    const id = String(e.meta?.id)
    if (id in vonHand) continue

    /*
     * Schon zugeordnet? Dann ist das ein Treffer und keine offene Frage —
     * unabhaengig davon, ob der Name heute noch passt. Die Entscheidung
     * steht in manual.betrieb_fremd_id und wird hier nicht neu verhandelt.
     * Wer sie aendern will, traegt sie in VON_HAND ein oder loescht die
     * Zeile; beides ist eine Handlung und kein Nebeneffekt.
     */
    const schon = bestehend.get(id)
    if (schon !== undefined && nachKey.has(schon)) {
      belegt.add(schon)
      treffer.push({ entitaetsId: id, betriebKey: schon, yext: e.name ?? '',
                     betrieb: nachKey.get(schon)!, art: 'bereits zugeordnet', e })
      continue
    }

    const nE = norm(e.name ?? '')
    let b = betriebe.find(x => norm(x.name) === nE && !belegt.has(x.betrieb_key))
    let art = 'Name identisch'
    if (!b) {
      // Deckt den Regelfall ab: LINA fuehrt die Rechtsform mit, Yext nicht.
      b = betriebe.find(x => !belegt.has(x.betrieb_key) &&
        (norm(x.name).includes(nE) || nE.includes(norm(x.name))))
      art = 'Name enthaelt'
    }
    if (b) {
      belegt.add(b.betrieb_key)
      treffer.push({ entitaetsId: id, betriebKey: b.betrieb_key, yext: e.name ?? '', betrieb: b.name, art, e })
    } else offen.push(e)
  }

  const ausdruecklichOffen = Object.entries(vonHand).filter(([, v]) => v === null).map(([k]) => k)
  return { treffer, offen, ausdruecklichOffen }
}

/**
 * Der Abgleich. `schreiben: false` rechnet nur — dieselbe Rechnung, damit die
 * Vorschau nicht von der Uebernahme abweichen kann.
 *
 * WIRFT. Anders als die uebrigen Nachlaeufe: der Aufrufer in
 * `yext/nachlauf.ts` faengt alles ab (Regel 1 dort), und ein Fehler hier ist
 * fuer die Vorschau im Terminal ein Fehler, den man sehen will.
 */
export async function zuordnungAbgleichen(
  opt: { schreiben?: boolean } = {},
): Promise<Zuordnungsbericht> {
  if (!yextKonfiguriert()) throw new Error('YEXT_API_KEY ist nicht gesetzt')

  const [alleEntitaeten, ordner] = [await entitaetenHolen(), await ordnerHolen()]
  const ordnerNachId = new Map(ordner.map(o => [String(o.id), o]))

  /** Der Ordner der obersten Ebene ueber einer Entitaet — der sagt, wessen Kunde das ist. */
  const oberOrdner = (id?: string): string => {
    let cur = ordnerNachId.get(String(id))
    let name = cur?.name ?? ''
    for (let i = 0; cur && cur.parentId && cur.parentId !== '0' && i < 10; i++) {
      cur = ordnerNachId.get(String(cur.parentId))
      if (cur?.name) name = cur.name
    }
    return name
  }

  /**
   * Nur Restaurants aus unseren Ordnern.
   *
   * Der Typfilter erledigt zwei Faelle nebenbei: die sechs Markensaetze
   * (entityType 'brand') und die Zentrale in Graefelfing ('location'). Die
   * Zentrale ist kein Betrieb, traegt aber "CONCEPT FAMILY" im Namen und
   * traefe ueber den Namensabgleich ausgerechnet auf "A Testladen Concept
   * Family" -- ein Treffer, der wie ein Erfolg aussieht und keiner ist.
   */
  const entitaeten = alleEntitaeten.filter(e =>
    e.meta?.entityType === 'restaurant' && UNSERE_ORDNER.has(oberOrdner(e.meta?.folderId)))

  const koordinate = (e: YextEntitaet) =>
    e.yextDisplayCoordinate ?? e.geocodedCoordinate ?? e.displayCoordinate

  const betriebe = await query<{ betrieb_key: number; name: string }>(
    `SELECT betrieb_key, name FROM core.betrieb WHERE aktiv ORDER BY betrieb_key`)

  const vorhanden = await query<{ betrieb_key: number; fremd_id: string }>(
    `SELECT betrieb_key, fremd_id FROM manual.betrieb_fremd_id WHERE system = 'yext'`)
  const bestehend = new Map(vorhanden.map(z => [z.fremd_id, z.betrieb_key]))

  const { treffer, offen, ausdruecklichOffen } =
    zuordnungRechnen(entitaeten, betriebe, bestehend)
  const mitGeo = treffer.filter(t =>
    koordinate(t.e)?.latitude != null && koordinate(t.e)?.longitude != null)

  const bericht: Zuordnungsbericht = {
    treffer, mitGeo,
    entitaeten_im_konto: alleEntitaeten.length,
    entitaeten_unsere: entitaeten.length,
    zugeordnet: treffer.length,
    offen: offen.length + ausdruecklichOffen.length,
    mit_koordinaten: mitGeo.length,
    geschrieben: 0,
    offene_namen: [
      ...offen.map(e => ({
        id: String(e.meta?.id), name: e.name ?? '', ort: e.address?.city ?? '',
      })),
      ...ausdruecklichOffen.map(id => {
        const e = alleEntitaeten.find(x => x.meta?.id === id)
        return { id, name: e?.name ?? '', ort: e?.address?.city ?? '' }
      }),
    ],
  }

  if (!opt.schreiben) return bericht

  const r = await query(
    `INSERT INTO manual.betrieb_fremd_id (betrieb_key, system, fremd_id)
     SELECT * FROM unnest($1::int[], $2::text[], $3::text[])
     ON CONFLICT (betrieb_key, system) DO UPDATE SET fremd_id = EXCLUDED.fremd_id
     RETURNING betrieb_key`,
    [treffer.map(t => t.betriebKey), treffer.map(() => 'yext'), treffer.map(t => t.entitaetsId)])

  // herkunft 'concept_family': die Daten kommen aus dem Yext-Konto der
  // Family & Friends Marketing, nicht aus LINA und nicht aus einem
  // Geocoder von uns. genauigkeit 'adresse', weil Yext auf die
  // Hausnummer geokodiert -- erkennbar an sechs Nachkommastellen.
  await query(
    `INSERT INTO manual.betrieb_standort
       (betrieb_key, strasse, plz, ort, breitengrad, laengengrad, herkunft, genauigkeit, notiz)
     SELECT *, 'concept_family', 'adresse', 'Yext-Entitaeten (API)'
       FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[])
     ON CONFLICT (betrieb_key) DO UPDATE SET
       strasse = EXCLUDED.strasse, plz = EXCLUDED.plz, ort = EXCLUDED.ort,
       breitengrad = EXCLUDED.breitengrad, laengengrad = EXCLUDED.laengengrad,
       herkunft = EXCLUDED.herkunft, genauigkeit = EXCLUDED.genauigkeit,
       notiz = EXCLUDED.notiz, geaendert_am = now()
     -- NUR was Yext selbst geschrieben hat. Ein von Hand gepflegter
     -- Standort (herkunft <> 'concept_family') bleibt unangetastet: er ist
     -- eine Entscheidung, und seit dem 24.08.2026 laeuft dieser Abgleich
     -- taeglich — ohne diese Zeile ueberschriebe er sie jede Nacht neu.
     -- In Produktion stehen heute 60 Zeilen, alle von Yext; die Bedingung
     -- kostet also nichts und verhindert den Fall, bevor er eintritt.
     WHERE betrieb_standort.herkunft = 'concept_family'`,
    [mitGeo.map(t => t.betriebKey), mitGeo.map(t => t.e.address?.line1 || null),
     mitGeo.map(t => t.e.address?.postalCode || null), mitGeo.map(t => t.e.address?.city || null),
     mitGeo.map(t => koordinate(t.e)!.latitude), mitGeo.map(t => koordinate(t.e)!.longitude)])

  return { ...bericht, geschrieben: r.length }
}
