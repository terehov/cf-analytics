/**
 * Textbereinigung an der Aussengrenze — was aus einer fremden Antwort kommt,
 * bevor es in die Datenbank darf.
 */
import { log } from './log'

/**
 * NUL aus einer Antwort entfernen, bevor irgendetwas damit geschieht.
 *
 * PostgreSQL nimmt U+0000 weder in `text` noch in `jsonb` an. Daran sind am
 * 12.08.2026 im ersten Ladenakte-Lauf Belegordner gescheitert — und zwar
 * vollstaendig: ein Ordner wird in einer Transaktion geschrieben, ein einziges
 * NUL in einem einzigen Belegnamen nimmt also alle Belege dieses Ordners mit.
 *
 * ⚠ DIESE FUNKTION HAT DEN FALL AUS DEM PROTOKOLL NICHT GEFANGEN. Sie sieht nur
 * das rohe Byte; gescheitert ist der Lauf an der Escape-Folge. Warum das ein
 * Unterschied ist, steht bei `jsonOhneNullzeichen()` weiter unten — die beiden
 * gehoeren zusammen und decken erst gemeinsam beide Wege ab.
 *
 * Bereinigt wird an der Aussengrenze und nicht im Lader, weil jeder Lader
 * dieselbe Falle hat: `raw.api_antwort.payload` ist jsonb, und dort landet jede
 * JSON-Antwort dieses Projekts — LINA wie FoodNotify.
 *
 * ENTFERNT WIRD AUSSCHLIESSLICH U+0000. Andere Steuerzeichen sind in PostgreSQL
 * zulaessig; was hier mehr wegputzt als noetig, verfaelscht Daten, die hinterher
 * niemand mehr nachsehen kann — `raw` ist append-only (AGENTS.md Regel 4).
 *
 * Und es wird gemeldet. Eine stille Bereinigung waere genau die Sorte Eingriff,
 * die man ein halbes Jahr spaeter in keiner Zahl mehr wiederfindet.
 */
export function ohneNullzeichen(text: string, endpunkt: string): string {
  if (!text.includes('\0')) return text
  const anzahl = text.split('\0').length - 1
  log.warn('NUL-Zeichen aus der Antwort entfernt', { endpunkt, anzahl, wo: 'rohtext' })
  return text.replaceAll('\0', '')
}

/**
 * JSON lesen und dabei die NUL entfernen, die als ESCAPE-FOLGE ankommen.
 *
 * ⚠ DIE BEIDEN FUNKTIONEN HIER SEHEN AEHNLICH AUS UND FANGEN VERSCHIEDENE
 * DINGE. Das war der Fehler des ersten Anlaufs am 12.08.2026, und er ist teuer
 * genug, um ihn hier auszuschreiben.
 *
 * Ein NUL kann auf zwei Wegen in einer JSON-Antwort stecken:
 *
 *   als rohes Byte      — dann steht 0x00 im Antworttext. `ohneNullzeichen()`
 *                         faengt es. Fuer JSON ist das ohnehin der harmlosere
 *                         Fall: `JSON.parse` scheitert daran („Unterminated
 *                         string"), der Client meldet „Antwort ist kein JSON",
 *                         und kein Lader sieht die Daten je.
 *
 *   als Escape-Folge    — dann stehen im Antworttext die sechs gewoehnlichen
 *                         ASCII-Zeichen \ u 0 0 0 0. Der Rohtext enthaelt kein
 *                         einziges NUL, `ohneNullzeichen()` ist blind dafuer,
 *                         und `JSON.parse` macht daraus ein echtes U+0000.
 *                         Spaetestens `JSON.stringify` schreibt es wieder als
 *                         Escape — und genau das lehnt PostgreSQL ab.
 *
 * Die beiden Fehlermeldungen unterscheiden sich, und daran haengt die
 * Diagnose (gegen PostgreSQL 18 gemessen):
 *
 *   Escape-Folge   ERROR: unsupported Unicode escape sequence
 *   rohes Byte     ERROR: invalid byte sequence for encoding "UTF8": 0x00
 *
 * Im Laufprotokoll vom 12.08.2026 stand die erste. Der erste Anlauf hat
 * trotzdem nur die zweite behandelt und haette beim naechsten Lauf exakt
 * nichts geaendert — schlimmer noch, die WARN-Zeile waere ausgeblieben und
 * haette wie „es gab keine NUL" ausgesehen.
 *
 * Geprueft wird auf die Escape-Folge im Text, nicht blind bereinigt: der
 * Reviver-Weg kostet bei einer 8-MB-Antwort spuerbar mehr als ein einfaches
 * `JSON.parse`, und der Normalfall ist, dass gar kein NUL vorkommt. Ein
 * Fehlalarm (etwa bei einem doppelt maskierten Backslash) kostet nur diesen
 * Aufwand — gemeldet wird erst, wenn tatsaechlich etwas entfernt wurde.
 */
export function jsonOhneNullzeichen(text: string, endpunkt: string): unknown {
  if (!text.includes('\\u0000')) return JSON.parse(text)

  let entfernt = 0
  const daten = JSON.parse(text, (_schluessel, wert) => {
    if (typeof wert !== 'string' || !wert.includes('\0')) return wert
    entfernt += wert.split('\0').length - 1
    return wert.replaceAll('\0', '')
  })

  if (entfernt > 0) {
    log.warn('NUL-Zeichen aus der Antwort entfernt', { endpunkt, anzahl: entfernt, wo: 'json-escape' })
  }
  return daten
}
