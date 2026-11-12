/**
 * TPAPI Stufe 2: eine Antwort → `raw.api_antwort` + Abrufzeile, in EINER
 * Transaktion (Plan `docs/plan-tpapi-stufe2.md` §4, S1). Kein `core`-Lader —
 * der kommt mit Schritt 2b und liest dann aus `raw`; `core_stand` bleibt
 * hier NULL.
 *
 * DIE REIHENFOLGE IST DIE VERSICHERUNG (Regel 4), wie in `laden.ts`: zuerst
 * `raw`, dann die Abrufzeile, in derselben Transaktion — keine Abrufzeile
 * ohne Rohsatz. Die Antwort wird VOR der Transaktion gelesen (Verdichtung,
 * `listdays`); eine Form, die nicht passt, kann den Rohsatz damit nicht mit
 * zurückrollen.
 *
 * GLEICHER INHALT, KEIN ZWEITER ROHSATZ. Das Dreitagesfenster (S7) holt jeden
 * Tag dreimal; ein Journal hat 1–2 MB. Dreimal dieselben Bytes nach `raw` sind
 * bei 41 Betrieben rund 120 MB je Nacht ohne jede Information — `raw.payload_hash`
 * sagt selbst: „Gleicher Hash = fachlich nichts geaendert". Deshalb: ist der
 * Hash derselbe wie beim letzten erfolgreichen Abruf, zählt nur die
 * Abrufzeile hoch (`abrufe`, `abgerufen_am`) und zeigt weiter auf den
 * vorhandenen Rohsatz. `raw` bleibt append-only; es wird nur nichts Gleiches
 * angehängt. Ändert sich der Hash, kommt ein neuer Rohsatz, `geaendert_am`
 * wird gesetzt (die Messung für S7) und `core_stand` auf NULL — der Lader
 * aus 2b muss den Tag neu laden. Abweichung vom Plan, Begründung in §8.
 *
 * WAS NACH RAW GEHT:
 *   200            die Antwort als JSON, Schlüssel sortiert (`kanonischerJsonText`,
 *                  dieselbe Form wie Stufe 1 und der LINA-Client) — einmal
 *                  serialisiert, daraus Hash, Bytes und der gesendete Text.
 *                  Mit `verdichten` (personalkostenprotag): nur die Summe.
 *   kein 200       die gesäuberte Antwort des Clients wie in Stufe 1 — bei
 *                  Endpunkten mit `verdichten` nur die MELDUNG, nie der Text:
 *                  was eine Fehlerseite dort mitbringt, weiß niemand.
 *   Formfehler     bei `verdichten` nur die Meldung (`payload_text`,
 *                  `ladefehler`), sonst die Antwort.
 *   keine Antwort  nichts.
 *
 * Nicht ins Log: keine dieser Funktionen schreibt eine Logzeile mit Inhalt;
 * eine Journalantwort hat Megabytes und Freitext von Gästen.
 */
import type pg from 'pg'
import { inTransaktion, query } from '../db/pool'
import { jsonOhneNullzeichen, kanonischerJsonText } from '../lib/text'
import type { TpapiAntwort } from './client'
import type { TpapiEndpunkt } from './endpunkte'
import { FormFehler } from './form'
import { alsBusinessdate } from './laden'
import { geschaeftstageAusListdays, type Geschaeftstage } from './verdichtung'

export type RohErgebnis = {
  /** id in raw.api_antwort (bei `unveraendert` die des vorhandenen Rohsatzes); null ohne Antwort. */
  rawId: string | null
  /**
   *   neu           200, neuer Inhalt: Rohsatz und Abrufzeile geschrieben
   *   unveraendert  200, gleicher Hash wie zuletzt: nur die Abrufzeile
   *   nur_raw       kein 200: nur der Rohsatz (Beleg für den Zustand)
   *   formfehler    200, aber nicht lesbar: Rohsatz (bzw. Meldung), keine Abrufzeile
   *   ohne_antwort  nichts geschrieben
   */
  ergebnis: 'neu' | 'unveraendert' | 'nur_raw' | 'formfehler' | 'ohne_antwort'
  /** Zeilen der Antwort (Listenlänge; bei personalkostenprotag die Personen). */
  zeilen: number
  meldung?: string
  /** Nur `listdays`. */
  tage?: Geschaeftstage
}

/** Was aus einer 200-Antwort gespeichert wird — einmal serialisiert. */
type Gespeichert = { json: string; hash: string; bytes: number; zeilen: number }

function zeilenVon(daten: unknown): number {
  if (Array.isArray(daten)) return daten.length
  if (daten !== null && typeof daten === 'object') {
    const p = (daten as { personen?: unknown }).personen
    return typeof p === 'number' ? p : Object.keys(daten as object).length
  }
  return 0
}

/**
 * Eine 200-Antwort in die Form, die gespeichert wird. Wirft `FormFehler`
 * (nur aus `verdichten`).
 *
 * NUL-Zeichen: das Journal trägt Freitext (`addinfo`, `debitor_text`), und
 * ein als `\u0000` maskiertes NUL lehnt PostgreSQL in jsonb ab — der ganze
 * Rohsatz ginge verloren (Ladenakte, 12.08.2026, `lib/text.ts`). Nur dann
 * wird der Text ein zweites Mal gelesen.
 */
function gespeichert(ep: TpapiEndpunkt, a: TpapiAntwort): Gespeichert {
  let daten = a.roh.includes('\\u0000') ? jsonOhneNullzeichen(a.roh, ep.endpunkt) : a.daten
  if (ep.verdichten) daten = ep.verdichten(daten)
  const json = kanonischerJsonText(daten)
  return {
    json,
    hash: Bun.SHA256.hash(json, 'hex') as string,
    bytes: Buffer.byteLength(json, 'utf8'),
    zeilen: zeilenVon(daten),
  }
}

type RohSatz = {
  endpunkt: string
  encId: string
  tag: string | null
  parameter: Record<string, string>
  status: number
  json: string | null
  text: string | null
  hash: string
  bytes: number
  laufId: string | null
  ladefehler?: string | null
  /** Nur Bereichsabrufe: letzter Tag des Zeitraums (sonst = tag). */
  bis?: string | null
}

/**
 * Die Monatspartitionen von `raw.api_antwort` für heute und morgen —
 * einmal je Kalendertag und Prozess, AUSSERHALB der Datentransaktion.
 *
 * Stufe 1 ruft das je Rohsatz in der Transaktion (`laden.ts`); das kostet
 * rund 13 ms (gemessen 12.11.2026 auf dem Klon), bei bis zu 10.000 Aufrufen
 * in Phase C also gut zwei Minuten für nichts. Außerhalb der Transaktion,
 * damit eine zurückgerollte Transaktion nicht eine Partition mitnimmt, die
 * der Merker hier schon als angelegt führt.
 */
let partitionenGeprueftFuer: string | null = null
async function partitionenSichern(): Promise<void> {
  const heute = new Date().toISOString().slice(0, 10)
  if (partitionenGeprueftFuer === heute) return
  await query(
    `SELECT core.partition_anlegen('raw.api_antwort', d)
       FROM unnest(ARRAY[current_date, current_date + 1]) AS d`)
  partitionenGeprueftFuer = heute
}

async function rohSchreiben(c: pg.PoolClient, r: RohSatz): Promise<string> {
  const x = await c.query(
    `INSERT INTO raw.api_antwort
       (quelle, endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, parameter,
        http_status, payload, payload_text, payload_hash, payload_bytes, lauf_id, ladefehler)
     VALUES ('tpapi', $1, $2, $3::date, coalesce($12::date, $3::date), $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
     RETURNING id`,
    [r.endpunkt, r.encId, r.tag, JSON.stringify(r.parameter), r.status, r.json, r.text,
     r.hash, r.bytes, r.laufId, r.ladefehler ?? null, r.bis ?? null])
  return String(x.rows[0].id)
}

/** Rohsatz für eine Nicht-200-Antwort (oder einen Formfehler mit verdichtetem Endpunkt). */
function fehlerSatz(
  ep: TpapiEndpunkt, a: TpapiAntwort, encId: string, tag: string | null,
  parameter: Record<string, string>, laufId: string | null, ladefehler?: string,
): RohSatz {
  /*
   * Wie Stufe 1: JSON nach `payload`, sonst die MELDUNG des Clients (gekürzt,
   * durch `sauber()` gelaufen). Bei `verdichten` nie die Antwort selbst.
   */
  const json = !ep.verdichten && a.daten !== null && ladefehler === undefined
    ? kanonischerJsonText(a.daten) : null
  const text = json === null ? (ladefehler ?? a.meldung ?? '') : null
  const g = json ?? text ?? ''
  return {
    endpunkt: ep.endpunkt, encId, tag, parameter, status: a.status, json, text,
    hash: Bun.SHA256.hash(g, 'hex') as string, bytes: Buffer.byteLength(g, 'utf8'), laufId,
    ladefehler: ladefehler ?? null,
  }
}

/**
 * Eine Antwort eines TAGESENDPUNKTS (journal, journaltables,
 * personalkostenprotag) für einen Betrieb und Geschäftstag sichern.
 * Wirft nur bei Datenbankfehlern.
 */
export async function tagRohLaden(
  ep: TpapiEndpunkt, a: TpapiAntwort, betriebKey: number, encId: string,
  tag: string, laufId: string | null,
): Promise<RohErgebnis> {
  if (a.status === 0) return { rawId: null, ergebnis: 'ohne_antwort', zeilen: 0 }
  await partitionenSichern()
  const parameter = { businessdate: alsBusinessdate(tag) }

  if (a.art !== 'ok') {
    const rawId = await inTransaktion(c => rohSchreiben(c, fehlerSatz(ep, a, encId, tag, parameter, laufId)))
    return { rawId, ergebnis: 'nur_raw', zeilen: 0 }
  }

  let g: Gespeichert
  try {
    g = gespeichert(ep, a)
  } catch (e) {
    // Einen FormFehler wirft nur `verdichten` — also geht nur die Meldung
    // nach raw, nie die Antwort mit ihren Zeilen je Person.
    if (!(e instanceof FormFehler)) throw e
    const meldung = `unerwartete Antwortform: ${e.message}`
    const rawId = await inTransaktion(c => rohSchreiben(c, fehlerSatz(ep, a, encId, tag, parameter, laufId, meldung)))
    return { rawId, ergebnis: 'formfehler', zeilen: 0, meldung: e.message }
  }

  return inTransaktion(async c => {
    const alt = await c.query<{ payload_hash: string; raw_id: string }>(
      `SELECT payload_hash, raw_id::text AS raw_id FROM core.tpapi_abruf
        WHERE betrieb_key = $1 AND endpunkt = $2 AND geschaeftstag = $3
        FOR UPDATE`, [betriebKey, ep.endpunkt, tag])
    if (alt.rows[0]?.payload_hash === g.hash) {
      await c.query(
        `UPDATE core.tpapi_abruf
            SET abrufe = least(abrufe + 1, 2147483647), abgerufen_am = now(), http_status = $4
          WHERE betrieb_key = $1 AND endpunkt = $2 AND geschaeftstag = $3`,
        [betriebKey, ep.endpunkt, tag, a.status])
      return { rawId: alt.rows[0].raw_id, ergebnis: 'unveraendert' as const, zeilen: g.zeilen }
    }
    const rawId = await rohSchreiben(c, {
      endpunkt: ep.endpunkt, encId, tag, parameter, status: a.status, json: g.json, text: null,
      hash: g.hash, bytes: g.bytes, laufId,
    })
    /*
     * Der Konfliktzweig wird nur erreicht, wenn der Hash ein anderer ist
     * (gleicher Hash ist oben schon behandelt) — deshalb `geaendert_am`
     * dort ohne Bedingung, und `core_stand` zurück auf NULL.
     */
    await c.query(
      `INSERT INTO core.tpapi_abruf
         (betrieb_key, endpunkt, geschaeftstag, http_status, zeilen, payload_bytes,
          payload_hash, raw_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (betrieb_key, endpunkt, geschaeftstag) DO UPDATE SET
         http_status   = excluded.http_status,
         zeilen        = excluded.zeilen,
         payload_bytes = excluded.payload_bytes,
         payload_hash  = excluded.payload_hash,
         raw_id        = excluded.raw_id,
         abgerufen_am  = now(),
         abrufe        = least(core.tpapi_abruf.abrufe + 1, 2147483647),
         geaendert_am  = now(),
         core_stand    = NULL,
         ladefehler    = NULL,
         ladeversuche  = 0,
         ladefehler_stand = NULL,
         ladefehler_am = NULL`,
      [betriebKey, ep.endpunkt, tag, a.status, g.zeilen, g.bytes, g.hash, rawId])
    return { rawId, ergebnis: 'neu' as const, zeilen: g.zeilen }
  })
}

/** dd.mm.yyyy → YYYY-MM-DD, sonst null. */
function isoAusLinaDatum(t: string | undefined): string | null {
  const m = t ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t) : null
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/**
 * Eine tagfreie Liste (Artikelstamm) oder einen Bereichsabruf (Prognose,
 * `from`/`to`) für einen Betrieb sichern. Jeder erfolgreiche Abruf bekommt
 * eine Zeile in `core.tpapi_stammabzug`; ein neuer Rohsatz nur, wenn sich der
 * Hash gegen den letzten Abzug DESSELBEN Zeitraums geändert hat (seit 0153
 * `von`/`bis` — sonst verglich ein Monat der Historie mit dem Fenster von
 * gestern und schriebe jedes Mal einen neuen Rohsatz).
 */
export async function stammRohLaden(
  ep: TpapiEndpunkt, a: TpapiAntwort, betriebKey: number, encId: string,
  parameter: Record<string, string>, laufId: string | null,
): Promise<RohErgebnis> {
  if (a.status === 0) return { rawId: null, ergebnis: 'ohne_antwort', zeilen: 0 }
  await partitionenSichern()
  const von = isoAusLinaDatum(parameter.from)
  const bis = isoAusLinaDatum(parameter.to)
  if (a.art !== 'ok') {
    const rawId = await inTransaktion(c => rohSchreiben(c, fehlerSatz(ep, a, encId, von, parameter, laufId)))
    return { rawId, ergebnis: 'nur_raw', zeilen: 0 }
  }
  const g = gespeichert(ep, a)
  return inTransaktion(async c => {
    const alt = await c.query<{ payload_hash: string; raw_id: string }>(
      `SELECT payload_hash, raw_id::text AS raw_id FROM core.tpapi_stammabzug
        WHERE betrieb_key = $1 AND endpunkt = $2
          AND von IS NOT DISTINCT FROM $3::date AND bis IS NOT DISTINCT FROM $4::date
        ORDER BY abgerufen_am DESC, abzug_id DESC LIMIT 1`, [betriebKey, ep.endpunkt, von, bis])
    const gleich = alt.rows[0]?.payload_hash === g.hash
    const rawId = gleich ? alt.rows[0]!.raw_id : await rohSchreiben(c, {
      endpunkt: ep.endpunkt, encId, tag: von, parameter, status: a.status, json: g.json, text: null,
      hash: g.hash, bytes: g.bytes, laufId, bis,
    })
    await c.query(
      `INSERT INTO core.tpapi_stammabzug
         (betrieb_key, endpunkt, http_status, zeilen, payload_bytes, payload_hash, raw_id, neu, von, bis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [betriebKey, ep.endpunkt, a.status, g.zeilen, g.bytes, g.hash, rawId, !gleich, von, bis])
    return { rawId, ergebnis: gleich ? 'unveraendert' as const : 'neu' as const, zeilen: g.zeilen }
  })
}

/**
 * `listdays` für einen Betrieb: Rohsatz und `core.tpapi_geschaeftstag` in
 * einer Transaktion.
 *
 * `gesehen_am` wird für JEDEN gelieferten Tag auf die Zeit dieser
 * Transaktion gesetzt (eine Transaktion, ein `now()`). Damit ist „steht in der
 * jüngsten Liste" eine Gleichheit: `gesehen_am = max(gesehen_am)` je Betrieb —
 * und ein Tag, der hinten aus der Liste fällt (Betriebe mit einem Jahr Tiefe
 * verlieren jeden Tag einen), fällt aus der Arbeitsliste, statt jede Nacht
 * vergeblich gefragt zu werden. Gelöscht wird nichts.
 *
 * Immer ein neuer Rohsatz: die Liste ändert sich jeden Tag (der neue Tag
 * kommt hinzu), ein Hashvergleich spart hier nichts. Rund 60 KB je Betrieb
 * und Nacht bei Aalen.
 */
export async function listdaysLaden(
  ep: TpapiEndpunkt, a: TpapiAntwort, betriebKey: number, encId: string, laufId: string | null,
): Promise<RohErgebnis> {
  if (a.status === 0) return { rawId: null, ergebnis: 'ohne_antwort', zeilen: 0 }
  await partitionenSichern()
  if (a.art !== 'ok') {
    const rawId = await inTransaktion(c => rohSchreiben(c, fehlerSatz(ep, a, encId, null, {}, laufId)))
    return { rawId, ergebnis: 'nur_raw', zeilen: 0 }
  }
  let tage: Geschaeftstage | null = null
  let meldung: string | undefined
  try {
    tage = geschaeftstageAusListdays(a.daten)
  } catch (e) {
    if (!(e instanceof FormFehler)) throw e
    meldung = e.message
  }
  const g = gespeichert(ep, a)
  return inTransaktion(async c => {
    const rawId = await rohSchreiben(c, {
      endpunkt: ep.endpunkt, encId, tag: null, parameter: {}, status: a.status, json: g.json, text: null,
      hash: g.hash, bytes: g.bytes, laufId,
      ladefehler: meldung ? `unerwartete Antwortform: ${meldung}` : null,
    })
    if (tage === null) return { rawId, ergebnis: 'formfehler' as const, zeilen: g.zeilen, meldung }
    if (tage.tage.length > 0) {
      await c.query(
        `INSERT INTO core.tpapi_geschaeftstag (betrieb_key, geschaeftstag, raw_id)
         SELECT $1, t, $2 FROM unnest($3::date[]) AS t
         ON CONFLICT (betrieb_key, geschaeftstag) DO UPDATE SET
           gesehen_am = now(),
           raw_id     = excluded.raw_id`,
        [betriebKey, rawId, tage.tage])
    }
    return { rawId, ergebnis: 'neu' as const, zeilen: tage.tage.length, tage }
  })
}
