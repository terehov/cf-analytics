/**
 * Betriebsadressen aus dem Rohlayer — `core.betrieb_adresse` (Migration 0125).
 *
 * WOHER. Das Stammdatenblatt der Ladenakte (`la:stammdaten`) holt der
 * Nachtlauf seit 0053 einmal im Monat je Betrieb und legt das HTML in
 * `raw.api_antwort` ab. Darin steht in der Schlüssel-Wert-Tabelle eine Zeile
 * „Adresse" — die einzige Betriebsanschrift, die LINA liefert. Bis 0125 las
 * niemand sie (docs/befunde-datenlage.md sagte, LINA liefere keine Adresse;
 * das galt für die Berichtsendpunkte).
 *
 * WARUM AUS RAW UND NICHT IM LADER. `core` muss aus `raw` neu aufbaubar sein
 * (harte Regel 4). Liest diese Funktion den Rohlayer, füllt derselbe Weg die
 * Tabelle beim ersten Lauf aus den schon abgelegten Antworten UND hält sie
 * danach mit jedem neuen Abruf aktuell. Kein zusätzlicher Aufruf gegen LINA.
 *
 * NUR NEUERE ABRUFE: je Betrieb der jüngste Abruf, und nur, wenn er jünger
 * ist als der gespeicherte. Erst die Kennungen, dann das HTML — das
 * Stammdatenblatt ist groß, und nach dem ersten Lauf ist fast nie etwas neu.
 */
import { adresseLesen } from '../ladenakte/html'
import { query } from '../db/pool'

export async function adressenAusRawLaden(): Promise<{ gelesen: number; geschrieben: number }> {
  // abgerufen_am als TEXT: ein JS-Date kennt nur Millisekunden, Postgres
  // speichert Mikrosekunden. Mit Date als Parameter traf der Vergleich
  // "juenger als gespeichert" nie — nachgestellt am 29.09.2026 auf dem Klon.
  const neu = await query<{ id: string; abgerufen_am: string; betrieb_key: number }>(
    `WITH juengster AS (
       SELECT DISTINCT ON (a.parameter->>'linaBetriebId')
              a.id, a.abgerufen_am, (a.parameter->>'linaBetriebId')::int AS lid
         FROM raw.api_antwort a
        WHERE a.endpunkt = 'la:stammdaten' AND a.payload_text IS NOT NULL
        ORDER BY a.parameter->>'linaBetriebId', a.abgerufen_am DESC)
     SELECT j.id, j.abgerufen_am::text AS abgerufen_am, b.betrieb_key
       FROM juengster j
       JOIN core.betrieb b ON b.lina_betrieb_id = j.lid
       LEFT JOIN core.betrieb_adresse ba ON ba.betrieb_key = b.betrieb_key
      WHERE j.abgerufen_am > coalesce(ba.abgerufen_am, '-infinity'::timestamptz)`)

  let geschrieben = 0
  for (const n of neu) {
    const [r] = await query<{ payload_text: string }>(
      `SELECT payload_text FROM raw.api_antwort
        WHERE id = $1 AND abgerufen_am = $2::timestamptz AND endpunkt = 'la:stammdaten'`,
      [n.id, n.abgerufen_am])
    const a = r ? adresseLesen(r.payload_text) : null
    if (!a) continue
    await query(
      `INSERT INTO core.betrieb_adresse
         (betrieb_key, name_zeile, strasse, plz, ort, roh, abgerufen_am, raw_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
       ON CONFLICT (betrieb_key) DO UPDATE SET
         name_zeile = EXCLUDED.name_zeile, strasse = EXCLUDED.strasse,
         plz = EXCLUDED.plz, ort = EXCLUDED.ort, roh = EXCLUDED.roh,
         abgerufen_am = EXCLUDED.abgerufen_am, raw_id = EXCLUDED.raw_id,
         geladen_am = now()`,
      [n.betrieb_key, a.nameZeile, a.strasse, a.plz, a.ort, a.zeilen.join(' / '),
       n.abgerufen_am, n.id])
    geschrieben++
  }
  return { gelesen: neu.length, geschrieben }
}
