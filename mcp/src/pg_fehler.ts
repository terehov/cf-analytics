/**
 * Postgres-Fehler so weitergeben, dass man sie beheben kann.
 *
 * DER BEFUND, DER DIESE DATEI AUSGELOEST HAT — 21.09.2026, Analysesitzung
 * mit Claude. Jede Abfrage auf mart.wetter_tag, mart.vergleichstag und zwei
 * weitere Sichten antwortete:
 *
 *   current transaction is aborted, commands ignored until end of
 *   transaction block
 *
 * Das ist SQLSTATE 25P02 und sagt nichts ueber die Ursache. Die stand in dem
 * Fehler davor — "permission denied for schema core", CONTEXT: SQL function
 * "geschaeftstag" during inlining — und den hat der Server verschluckt
 * (`zeilenSchaetzen` in ausfuehren.ts, leeres catch). Das Ergebnis war
 * schlimmer als eine haessliche Meldung: ein Tippfehler in einem
 * Spaltennamen, eine defekte Sicht und eine fehlende Tabelle sahen ALLE
 * gleich aus. Nachgemessen am selben Tag:
 *
 *   SELECT gibtsnicht FROM mart.betrieb     -> 25P02 statt
 *                                              "column gibtsnicht does not exist"
 *   SELECT ... FROM mart.wetter_tag ...     -> 25P02 statt
 *                                              "permission denied for schema core"
 *
 * Ein Modell, das 25P02 liest, kann nur eines tun: dieselbe Abfrage anders
 * formulieren. Genau das Verhalten, gegen das der Pruefer geschrieben wurde.
 *
 * WAS EINE BRAUCHBARE MELDUNG TRAEGT. `pg` haengt an seine Fehler mehr als
 * `message`, und praktisch alles davon ist hier nuetzlich:
 *
 *   code      SQLSTATE — 42501 ist ein Rechteproblem, 42703 ein Tippfehler,
 *             42P01 eine fehlende Tabelle. Das ist der Unterschied zwischen
 *             "der Zugang darf nicht" und "die Abfrage ist falsch".
 *   detail    das Genauere, wo Postgres eines hat.
 *   hint      Postgres' eigener Vorschlag. Bei einem vertippten Spaltennamen
 *             steht dort oft schon der richtige.
 *   where     der Zusammenhang. Ohne diese Zeile waere am 21.09. nicht zu
 *             sehen gewesen, dass der Fehler aus einem FUNKTIONSRUMPF kommt
 *             und nicht aus der Sicht selbst.
 *   position  Zeichenposition in der Abfrage.
 */

/** Was ein pg-Fehler mitbringt, soweit es hier gebraucht wird. */
type Roh = {
  code?: string
  message?: string
  detail?: string
  hint?: string
  where?: string
  position?: string
  schema?: string
  table?: string
  column?: string
  routine?: string
}

/**
 * Die Folgemeldung. Sie ist kein Befund, sondern der Beweis, dass der
 * eigentliche Fehler vorher verschluckt wurde — deshalb steht sie hier
 * namentlich und wird in der Antwort ausdruecklich als das benannt.
 */
export const TRANSAKTION_ABGEBROCHEN = '25P02'

/** Ein Zeitueberlauf ist kein Defekt der Sicht, sondern eine Aussage ueber ihre Groesse. */
export const ZEITUEBERLAUF = '57014'

export function alsRoh(e: unknown): Roh {
  return (e !== null && typeof e === 'object' ? e : {}) as Roh
}

export function sqlstateVon(e: unknown): string | null {
  const c = alsRoh(e).code
  return typeof c === 'string' && c.length > 0 ? c : null
}

/**
 * Der Text, den das Modell zu sehen bekommt.
 *
 * SQLSTATE VORNE, weil es die einzige Angabe ist, die sich maschinell deuten
 * laesst: an 42501 erkennt ein Modell, dass Umformulieren nicht hilft.
 * Danach die Meldung, dann die Zusatzangaben, jede in einer eigenen Zeile —
 * ein Absatz aus fuenf aneinandergehaengten Halbsaetzen wird im Chat nicht
 * gelesen.
 */
export function pgFehlerText(e: unknown): string {
  const r = alsRoh(e)
  const zeilen: string[] = []
  const meldung = r.message ?? String(e)

  zeilen.push(r.code ? `Postgres SQLSTATE ${r.code}: ${meldung}` : `Postgres: ${meldung}`)
  if (r.detail) zeilen.push(`Genauer: ${r.detail}`)
  if (r.hint) zeilen.push(`Postgres schlaegt vor: ${r.hint}`)
  if (r.where) zeilen.push(`Zusammenhang: ${r.where.replace(/\s*\n\s*/g, ' / ')}`)
  if (r.position) zeilen.push(`Zeichen ${r.position} der Abfrage.`)

  const deutung = deuten(r)
  if (deutung) zeilen.push(deutung)

  return zeilen.join('\n')
}

/**
 * Die Deutung zu den haeufigen SQLSTATE-Klassen.
 *
 * Nicht Postgres' Aufgabe und nicht Dekoration: 42501 heisst hier etwas
 * Bestimmtes — dass eine Sicht der Auswertungsschicht fuer die Leserolle
 * kaputt ist —, und das steht in keiner Postgres-Meldung. Wer es nicht
 * dazuschreibt, laesst das Modell raten, ob es die Abfrage oder der Server
 * ist.
 */
function deuten(r: Roh): string | null {
  switch (r.code) {
    case TRANSAKTION_ABGEBROCHEN:
      return 'Das ist eine FOLGEMELDUNG, nicht die Ursache: irgendein Fehler davor hat die ' +
             'Transaktion abgebrochen, und diese Meldung verdeckt ihn. Ein Serverfehler — ' +
             'bitte melden, die Abfrage ist nicht schuld.'
    case '42501':
      return 'Ein RECHTEPROBLEM, kein Fehler der Abfrage: Umformulieren hilft nicht. Meist ' +
             'greift eine Sicht ueber einen Funktionsrumpf in ein gesperrtes Schema — ein ' +
             'Rumpf erbt die Rechte des Aufrufers, eine Sicht die ihres Eigentuemers. Die ' +
             'betroffenen Sichten stehen in mart.sicht_defekt, die Ursache in ' +
             'mart.leserolle_pruefung.'
    case '42703':
      return 'Die Spalte gibt es in dieser Sicht nicht. sicht_beschreiben nennt alle Spalten ' +
             '— die Namen dort sind verbindlich, nicht die vermuteten.'
    case '42P01':
      return 'Die Sicht oder Tabelle gibt es nicht. sichten_suchen findet den richtigen Namen; ' +
             'das Schema gehoert immer dazu (mart.<name>).'
    case '42883':
      return 'Diese Funktion gibt es nicht — oder nicht mit diesen Argumenttypen. Oft fehlt ' +
             'eine Umwandlung (::numeric, ::date).'
    case ZEITUEBERLAUF:
      return 'Die Abfrage hat ihre Zeitgrenze erreicht und wurde abgebrochen (20 s je Abfrage, ' +
             '5 s fuer eine Planungsprobe). ' +
             'Sie ist nicht falsch, nur zu gross: den Zeitraum enger fassen oder im SQL ' +
             'zusammenfassen statt Einzelzeilen zu ziehen.'
    case '22012':
      return 'Division durch Null. In dieser Schicht wird dafuer nullif(nenner, 0) benutzt — ' +
             'das Ergebnis ist dann leer statt falsch.'
    default:
      return null
  }
}

/**
 * Ist dieser Fehler ein Defekt der Sicht — oder nur eine Aussage ueber ihre
 * Groesse? Fuer den Gesundheitslauf: ein Zeitueberlauf und ein
 * Verbindungsabbruch sagen nichts darueber, ob die Sicht lesbar IST.
 */
export function istSichtDefekt(e: unknown): boolean {
  const code = sqlstateVon(e)
  if (code === null) return false
  if (code === ZEITUEBERLAUF) return false
  if (code === TRANSAKTION_ABGEBROCHEN) return false
  // Klasse 53 = Ressourcen erschoepft, 57 = Eingriff des Betreibers,
  // 58 = Systemfehler, 08 = Verbindung. Alles Zustaende der Maschine, nicht
  // der Sicht.
  if (/^(08|53|57|58)/.test(code)) return false
  return true
}
