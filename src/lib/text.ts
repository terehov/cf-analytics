/**
 * Textbereinigung an der Aussengrenze — was aus einer fremden Antwort kommt,
 * bevor es in die Datenbank darf.
 */
import { log } from './log'

/**
 * NUL aus einer Antwort entfernen, bevor irgendetwas damit geschieht.
 *
 * PostgreSQL nimmt U+0000 weder in `text` noch in `jsonb` an; jsonb quittiert es
 * mit „unsupported Unicode escape sequence". Genau daran sind am 12.08.2026 im
 * ersten Ladenakte-Lauf 14 Belegordner gescheitert — und zwar vollstaendig: ein
 * Ordner wird in einer Transaktion geschrieben, ein einziges NUL in einem
 * einzigen Belegnamen nimmt also alle Belege dieses Ordners mit.
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
  log.warn('NUL-Zeichen aus der Antwort entfernt', { endpunkt, anzahl })
  return text.replaceAll('\0', '')
}
