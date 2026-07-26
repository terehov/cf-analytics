/**
 * Zeitbehandlung an der LINA-Grenze.
 *
 * Zusammen mit core.geschaefts_zeitzone() in der Datenbank die einzigen zwei Stellen,
 * an denen 'Europe/Berlin' steht. Container und Datenbank laufen in UTC — die
 * Umgebungszeitzone ist bewusst nicht tragend.
 *
 * Zwei Arten von Zeit, die nicht vermischt werden dürfen:
 *
 *   Zeitpunkt      LINAs from/to (Unix-Epoch), abgerufen_am
 *                  -> Date / timestamptz, intern UTC. Nichts anzunehmen.
 *
 *   Geschäftsdatum geschaeftstag, monat, die DD.MM.YYYY-Parameter
 *                  -> zeitzonenloses Etikett für einen Berliner Abrechnungs-
 *                     zeitraum. Eine Umrechnung nach UTC wäre sinnlos: der
 *                     Wert hat keine Uhrzeit.
 */

export const GESCHAEFTS_ZEITZONE = 'Europe/Berlin' as const

/** Geschäftstag beginnt um 08:00 Ortszeit und endet 07:59 des Folgetags. */
export const GESCHAEFTSTAG_START_STUNDE = 8

/** Wanduhr-Bestandteile eines Zeitpunkts in der Geschäftszeitzone — DST-sicher. */
function wanduhr(d: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: GESCHAEFTS_ZEITZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const g = (t: string) => Number(p.find(x => x.type === t)!.value)
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') % 24 }
}

/** Der Geschäftstag, zu dem ein Zeitpunkt gehört. */
export function geschaeftstag(at: Date): string {
  const { y, m, d, h } = wanduhr(at)
  const day = new Date(Date.UTC(y, m - 1, d))
  if (h < GESCHAEFTSTAG_START_STUNDE) day.setUTCDate(day.getUTCDate() - 1)
  return day.toISOString().slice(0, 10)
}

/** Stunde 0–23 aus dem Zeitzonenbericht dem Geschäftstag zuordnen. */
export function geschaeftstagFuerStunde(kalendertag: string, hour: number): string {
  if (hour >= GESCHAEFTSTAG_START_STUNDE) return kalendertag
  const d = new Date(`${kalendertag}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Normalisiert auf YYYY-MM-DD.
 *
 * Ein Treiber, der date-Spalten als Date-Objekt statt als String liefert,
 * bricht alles, was ein ISO-Datum erwartet. Bei node-postgres ist der
 * Typparser dafür in src/db/pool.ts abgeschaltet — verlassen wollen wir uns
 * darauf aber nicht, dieser Übergang nimmt beides an.
 * Der Ende-zu-Ende-Test hat genau das aufgedeckt.
 */
export function alsIsoDatum(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

/** ISO-Datum -> LINAs Parameterformat. */
export function zuLinaDatum(wert: string | Date, style: 'padded' | 'short' = 'padded'): string {
  const [y, m, d] = alsIsoDatum(wert).split('-')
  return style === 'padded'
    ? `${d}.${m}.${y}`                          // Konzern-Endpunkte: 01.06.2026
    : `${Number(d)}.${Number(m)}.${y}`          // Betriebs-Reports:  1.6.2026
}

/**
 * LINAs Unix-Sekunden -> Zeitpunkt.
 *
 * Ein Epoch-Wert ist absolut und braucht keine Zeitzone; die Umrechnung ist
 * deshalb trivial — aber sie gehört trotzdem hierher und nicht verstreut in
 * die Transformationen. LINA liefert Epochs in `prices[].updated`, in den
 * Bestellzeiten und in den Inventurterminen, und jede Stelle, die das selbst
 * rechnet, ist eine Stelle, an der jemand versehentlich Millisekunden annimmt.
 *
 * Null, undefined, 0 und Unfug ergeben null — LINA benutzt 0 als „nie".
 */
export function ausLinaEpoch(sekunden: unknown): Date | null {
  const n = Number(sekunden)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000)
}

/**
 * LINAs Unix-Sekunden -> ISO-Datum im Geschäftskalender.
 *
 * Für Termine, die als Tag gemeint sind (Inventurstichtage, Lieferdaten).
 * Bewusst über die Berliner Wanduhr: 1486551600 ist der 08.02.2017 in Berlin,
 * in UTC aber noch der 07.02. Wer hier UTC nimmt, verschiebt jeden Termin,
 * der vor 01:00 bzw. 02:00 Ortszeit liegt, um einen Tag nach hinten.
 */
export function linaEpochAlsDatum(sekunden: unknown): string | null {
  const d = ausLinaEpoch(sekunden)
  if (!d) return null
  const { y, m, d: tag } = wanduhr(d)
  return `${y}-${String(m).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

/**
 * Prüft LINAs from/to-Epoch gegen den erwarteten Geschäftszeitraum.
 *
 * Verifiziert am 25.07.2026: from=1780264800 entspricht 2026-06-01 00:00
 * Europe/Berlin. Sollte LINA seine Zeitbehandlung je ändern, verschieben sich
 * unsere Tagesgrenzen still — deshalb wird das bei jedem Lauf geprüft und
 * eine Abweichung nach sync.schema_abweichung geschrieben.
 */
export function epochIstBerlinerMitternacht(epochSeconds: number, expectedIsoDate: string): boolean {
  const { y, m, d, h } = wanduhr(new Date(epochSeconds * 1000))
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return iso === expectedIsoDate && h === 0
}

/**
 * Stunde (0–23) eines Zeitpunkts in der Geschäftszeitzone.
 *
 * formatToParts statt format(): die deutsche Locale hängt an eine reine
 * Stundenausgabe " Uhr" an ("22 Uhr"), Number() darauf ergibt NaN. Das hat
 * das Arbeitsfenster des Importers dauerhaft geschlossen gehalten und wurde
 * erst vom Ende-zu-Ende-Test gefunden.
 */
export function stundeInGeschaeftszeitzone(zeitpunkt: Date): number {
  const { h } = wanduhr(zeitpunkt)
  if (!Number.isFinite(h)) throw new Error('Stunde nicht ermittelbar — Zeitzonenkonfiguration prüfen')
  return h
}
