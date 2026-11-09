/**
 * Eine TPAPI-Antwort → `raw.api_antwort` → `core.personalkosten_stunde`
 * (+ `_abruf`), in EINER Transaktion.
 *
 * DIE REIHENFOLGE IST DIE VERSICHERUNG (Regel 4). Zuerst `raw`, dann `core`,
 * in derselben Transaktion: es gibt keinen Stand, in dem `core` eine Zeile
 * trägt, deren Rohantwort fehlt. Umgekehrt wird die Antwort VOR der
 * Transaktion zerlegt — eine Form, die nicht passt, kann den Rohsatz damit
 * nicht mit zurückrollen. Er bleibt, der Tag wird nicht geladen, und der
 * Nachlauf meldet den Betrieb als `fehler`.
 *
 * `kostUser` GEHT NICHT NACH RAW (Plan D3). Begründung in `form.ts`
 * (`ohnePersonenbezug`). Auch der Hash wird aus der bereinigten Antwort
 * gebildet: ein Hash über Lohnkosten je Person wäre zwar kein Klartext, aber
 * er änderte sich mit jeder Umbuchung zwischen zwei Personen, ohne dass sich
 * an den gespeicherten Zahlen etwas ändert — und `raw.payload_hash` soll
 * messen, ob sich der TAG geändert hat.
 *
 * EIN ERNEUTER ABRUF ERSETZT DEN TAG VOLLSTÄNDIG: `DELETE` je Betrieb und
 * Tag, dann `INSERT`. Ein Upsert je Stunde ließe eine Stunde stehen, die LINA
 * heute nicht mehr liefert — eine gestrichene Schicht bliebe für immer
 * eingeplant (Plan §3.1).
 *
 * Auch 403 und 429 werden roh gesichert: kleine Antworten, und sie sind der
 * Beleg für den Zustand in `sync.tpapi_zugang`. Nur wo GAR KEINE Antwort kam
 * (Netz, Zeitgrenze), gibt es nichts zu sichern.
 */
import type pg from 'pg'
import { inTransaktion } from '../db/pool'
import { kanonischerJsonText } from '../lib/text'
import type { TpapiAntwort } from './client'
import { FormFehler, ohnePersonenbezug, stundenAusAntwort, type Tagesform } from './form'

export const ENDPUNKT_PERSONAL_STUNDE = 'tpapi:personalkostenprostunde'

export type TagErgebnis = {
  /** id in raw.api_antwort; null, wenn keine Antwort kam. */
  rawId: string | null
  /**
   *   geladen     200, mindestens eine Stunde in core
   *   leer        200, keine Stunde — als geholt vermerkt (D5)
   *   nur_raw     kein 200: nur der Rohsatz
   *   formfehler  200, aber nicht die gemessene Form: nur der Rohsatz
   *   ohne_antwort  nichts geschrieben
   */
  ergebnis: 'geladen' | 'leer' | 'nur_raw' | 'formfehler' | 'ohne_antwort'
  stunden: number
  /** Bei formfehler: was nicht passte (ohne Werte). */
  meldung?: string
}

/** dd.mm.yyyy aus YYYY-MM-DD — so will es `businessdate`. */
export function alsBusinessdate(tag: string): string {
  const [y, m, d] = tag.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

async function rohSichern(
  c: pg.PoolClient, a: TpapiAntwort, encId: string, tag: string, laufId: string | null,
): Promise<string> {
  await c.query(
    `SELECT core.partition_anlegen('raw.api_antwort', d)
       FROM unnest(ARRAY[current_date, current_date + 1]) AS d`)

  /*
   * JSON nach `payload` (ohne Personenbezug), sonst die Meldung des Clients
   * nach `payload_text` — eine 502-Seite eines Proxys ist kein JSON und
   * trotzdem der Beleg, warum der Tag fehlt. Bewusst die MELDUNG und nicht
   * `roh`: sie ist gekürzt und durch `sauber()` gelaufen. Eine Fehlerseite,
   * die den Schlüssel zitiert, soll ihn nicht in eine append-only-Tabelle
   * schreiben.
   */
  const json = a.daten !== null ? kanonischerJsonText(ohnePersonenbezug(a.daten)) : null
  const text = json === null ? (a.meldung ?? '') : null
  const gespeichert = json ?? text ?? ''

  const r = await c.query(
    `INSERT INTO raw.api_antwort
       (quelle, endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, parameter,
        http_status, payload, payload_text, payload_hash, payload_bytes, lauf_id)
     VALUES ('tpapi', $1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [ENDPUNKT_PERSONAL_STUNDE, encId, tag,
     JSON.stringify({ businessdate: alsBusinessdate(tag) }),
     a.status, json, text,
     Bun.SHA256.hash(gespeichert, 'hex'),
     new TextEncoder().encode(gespeichert).length,
     laufId])
  return String(r.rows[0].id)
}

async function tagSchreiben(
  c: pg.PoolClient, form: Tagesform, betriebKey: number, tag: string, rawId: string,
): Promise<void> {
  await c.query(
    `DELETE FROM core.personalkosten_stunde WHERE betrieb_key = $1 AND geschaeftstag = $2`,
    [betriebKey, tag])
  if (form.stunden.length > 0) {
    await c.query(
      `INSERT INTO core.personalkosten_stunde
         (betrieb_key, geschaeftstag, stunde, personen, personalkosten, raw_id)
       SELECT $1, $2, s.stunde, s.personen, s.personalkosten, $3
         FROM unnest($4::smallint[], $5::numeric[], $6::numeric[])
           AS s(stunde, personen, personalkosten)`,
      [betriebKey, tag, rawId,
       form.stunden.map(s => s.stunde),
       form.stunden.map(s => s.personen),
       form.stunden.map(s => s.personalkosten)])
  }
  /*
   * Die Abrufzeile auch für einen leeren Tag (D5): sonst zöge der Backfill
   * die leeren Tage eines Betriebs ohne geplante Schichten jede Nacht neu,
   * bis in alle Ewigkeit. `abrufe` zählt, wie oft der Tag geholt wurde —
   * zusammen mit `raw.payload_hash` die Messung, ob das 14-Tage-Fenster
   * zu kurz oder zu lang ist.
   */
  await c.query(
    `INSERT INTO core.personalkosten_stunde_abruf
       (betrieb_key, geschaeftstag, stunden, personenstunden, personalkosten,
        raw_id, abgerufen_am, abrufe)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 1)
     ON CONFLICT (betrieb_key, geschaeftstag) DO UPDATE SET
       stunden         = excluded.stunden,
       personenstunden = excluded.personenstunden,
       personalkosten  = excluded.personalkosten,
       raw_id          = excluded.raw_id,
       abgerufen_am    = now(),
       abrufe          = least(core.personalkosten_stunde_abruf.abrufe + 1, 32767)`,
    [betriebKey, tag, form.stunden.length, form.personenstunden, form.personalkosten, rawId])
}

/**
 * Eine Antwort für einen Betrieb und Geschäftstag laden.
 *
 * `geschaeftstag` ist LINAs `businessdate` als YYYY-MM-DD — unverändert, auch
 * für die Stunden 0–7 (Plan §1). Wirft nur bei Datenbankfehlern; eine
 * unpassende Antwort ist ein Ergebnis, kein Fehler.
 */
export async function tagLaden(
  antwort: TpapiAntwort, betriebKey: number, encId: string,
  geschaeftstag: string, laufId: string | null,
): Promise<TagErgebnis> {
  if (antwort.status === 0) return { rawId: null, ergebnis: 'ohne_antwort', stunden: 0 }

  let form: Tagesform | null = null
  let formMeldung: string | undefined
  if (antwort.art === 'ok') {
    try {
      form = stundenAusAntwort(antwort.daten)
    } catch (e) {
      if (!(e instanceof FormFehler)) throw e
      formMeldung = e.message
    }
  }

  return inTransaktion(async c => {
    const rawId = await rohSichern(c, antwort, encId, geschaeftstag, laufId)
    if (antwort.art !== 'ok') return { rawId, ergebnis: 'nur_raw', stunden: 0 }
    if (form === null) return { rawId, ergebnis: 'formfehler', stunden: 0, meldung: formMeldung }
    await tagSchreiben(c, form, betriebKey, geschaeftstag, rawId)
    return { rawId, ergebnis: form.leer ? 'leer' : 'geladen', stunden: form.stunden.length }
  })
}
