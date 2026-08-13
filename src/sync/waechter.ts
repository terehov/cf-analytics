/**
 * Der Wächter über das Berichtsregister.
 *
 * WOGEGEN ER SCHÜTZT. Ein Endpunkt zu aktivieren ist ein Einzeiler:
 * `aktiv: false` wird `aktiv: true`. Ob dahinter überhaupt etwas passiert,
 * hängt aber an drei weiteren Stellen — und **jede davon versagt lautlos**.
 * Der Posten meldet „ok", die Zieltabelle bleibt leer, und niemand erfährt es.
 * Genau diese Signatur hat dieses Projekt zweimal Tage gekostet, und beide
 * Male stand hinterher derselbe Satz da: *ein Importer ohne Arbeit sieht
 * genauso aus wie einer, der fertig ist.*
 *
 * Drei Zusicherungen, alle drei am 13.08.2026 im Review gemessen:
 *
 *   1. EINREIHZWEIG. `linaNachfuellen()` kennt Zweige für `tag`, `jahr` und
 *      Momentaufnahmen — aber keinen für `monat`. Alle vier
 *      `getReport`-Endpunkte tragen `schrittweite: 'monat'`. Wer einen davon
 *      aktiviert, reiht damit weiterhin NULL Posten ein und merkt es nicht.
 *
 *   2. DISPATCH-CASE. Der `switch` in `laden.ts` hat einen stillen
 *      `default: break`. Was dort durchrutscht, schreibt raw, meldet „ok" und
 *      transformiert nichts. Genau daran ist der Aktionsbericht einmal
 *      monatelang vorbeigelaufen.
 *
 *   3. PRODUCER FÜR `betrieb_enc_id`. Endpunkte mit `ebene: 'betrieb'`
 *      brauchen `storeId`; der Worker nimmt ihn aus
 *      `sync.warteschlange.betrieb_enc_id` (`worker.ts`). Nachgesehen am
 *      13.08.2026: **kein einziger `INSERT` im ganzen Repo setzt diese
 *      Spalte.** Sie wird ausschliesslich gelesen. Ein aktivierter
 *      Betriebs-Endpunkt liefe also ohne `storeId` los — ohne Fehler.
 *
 * WARUM ER WIRFT UND NICHT WARNT. Ein Log-WARN liest niemand (AGENTS.md
 * Regel 10). Und anders als die Befunde in der Datenbank ist das hier kein
 * Datenzustand, sondern ein Baufehler: er entsteht beim Deploy und ist beim
 * Deploy auch behebbar. Deshalb zweimal geprüft — als Test vor dem Deploy
 * (`waechter.test.ts`) und beim Start jedes Laufs, falls jemand am Test
 * vorbei deployt.
 *
 * WAS ER NICHT PRÜFT. FoodNotify und die Ladenakte haben eigene Register mit
 * eigenen Ladern (`fnLaden`, `laLaden`); `laLaden` hat statt eines stillen
 * `default:` bereits ein `throw`. Dieser Wächter gilt dem LINA-Register, wo
 * die drei Lücken gemessen sind.
 */
import { AKTIVE_ENDPUNKTE, istMomentaufnahme, type Schrittweite } from '../lina/endpunkte'
import { istLadenakte } from '../ladenakte/endpunkte'
import { TRANSFORMIERTE_ENDPUNKTE } from './laden'

/**
 * Für welche Schrittweiten `linaNachfuellen()` einen Einreihzweig hat.
 *
 * SIE MUSS MIT `linaNachfuellen()` ÜBEREINSTIMMEN und tut es heute:
 * `schrittweite === 'tag'`, `=== 'jahr'` und `istMomentaufnahme`. `monat`
 * fehlt dort bewusst — es gibt keinen einzigen aktiven Monatsendpunkt, und
 * ein Zweig ohne Nutzer wäre ungetesteter Code. Wer den ersten aktiviert,
 * baut ihn; bis dahin sagt dieser Wächter, dass er fehlt.
 */
const EINREIHBARE_SCHRITTWEITEN: ReadonlySet<Schrittweite> =
  new Set<Schrittweite>(['tag', 'jahr', 'momentaufnahme'])

/**
 * Endpunkte, die absichtlich nur `raw` schreiben.
 *
 * Bisher keine. Die Menge steht trotzdem hier, damit die Ausnahme eine
 * bewusste Eintragung mit Begründung ist und kein weggelassener Fall — sonst
 * landet die erste Ausnahme wieder im stillen `default:`-Zweig.
 */
const NUR_ROH: ReadonlySet<string> = new Set<string>([])

export class RegisterVerletzt extends Error {
  constructor(verstoesse: string[]) {
    super(
      `Das Berichtsregister und der Code passen nicht zusammen `
      + `(${verstoesse.length} ${verstoesse.length === 1 ? 'Verstoss' : 'Verstoesse'}):\n`
      + verstoesse.map(v => `  - ${v}`).join('\n')
      + `\n\nJeder dieser Faelle laeuft sonst LAUTLOS: der Posten meldet "ok" und `
      + `die Zieltabelle bleibt leer. Begruendung je Zusicherung in src/sync/waechter.ts.`)
    this.name = 'RegisterVerletzt'
  }
}

/** Die drei Zusicherungen prüfen. Wirft `RegisterVerletzt`, sonst still. */
export function endpunkteZusichern(): void {
  const verstoesse: string[] = []

  for (const ep of AKTIVE_ENDPUNKTE) {
    // Die Ladenakte reiht über `ladenakteNachfuellen()` ein und lädt über
    // `laLaden()` — beides eigene Wege mit eigenen Zusicherungen.
    if (istLadenakte(ep.key)) continue

    // 1. Einreihzweig für die Schrittweite
    if (!EINREIHBARE_SCHRITTWEITEN.has(ep.schrittweite)) {
      verstoesse.push(
        `${ep.key}: schrittweite '${ep.schrittweite}' hat keinen Einreihzweig in `
        + `linaNachfuellen(). Der Endpunkt ist aktiv, wird aber nie eingereiht — `
        + `null Posten, null Fehler.`)
    }

    // 2. Dispatch-Case, der ihn nach core bringt
    if (!TRANSFORMIERTE_ENDPUNKTE.has(ep.key) && !NUR_ROH.has(ep.key)) {
      verstoesse.push(
        `${ep.key}: kein Fall im Dispatch von laden.ts. Der Posten wuerde raw `
        + `schreiben, "ok" melden und nichts nach core transformieren. Entweder `
        + `einen Fall bauen oder ihn mit Begruendung in NUR_ROH eintragen.`)
    }

    // 3. Producer für betrieb_enc_id, falls betriebsweise geholt wird
    if (ep.ebene === 'betrieb') {
      verstoesse.push(
        `${ep.key}: ebene 'betrieb' braucht storeId aus `
        + `sync.warteschlange.betrieb_enc_id — diese Spalte hat aber KEINEN `
        + `Producer (kein INSERT im Repo setzt sie, Stand 13.08.2026). Der `
        + `Aufruf liefe ohne storeId los, ohne Fehler. Erst den Einreihweg je `
        + `Betrieb bauen, dann aktivieren.`)
    }
  }

  // Die Gegenprobe: eine Momentaufnahme ohne Momentaufnahme-Erkennung wäre
  // derselbe Fehler von der anderen Seite — sie liefe dann täglich statt
  // monatlich, und das fällt nur am Aufrufzähler auf.
  for (const ep of AKTIVE_ENDPUNKTE) {
    if (ep.schrittweite === 'momentaufnahme' && !istMomentaufnahme(ep)) {
      verstoesse.push(
        `${ep.key}: schrittweite 'momentaufnahme', aber istMomentaufnahme() sagt `
        + `nein. Der Endpunkt liefe taeglich statt monatlich.`)
    }
  }

  if (verstoesse.length > 0) throw new RegisterVerletzt(verstoesse)
}
