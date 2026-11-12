/**
 * `sync.tpapi_zugang` — welcher Betrieb einen Schlüssel hat und wie der
 * letzte Aufruf JE MODUL ausging (0149; je Modul seit 0151, Plan Stufe 2 S9).
 *
 * Bis 0151 stand `zugangSpiegeln()` in `nachlauf.ts` und kannte nur das Modul
 * `personal`. Hierher gezogen, weil Stufe 2 dieselbe Spiegelung für `revenue`
 * und `artikel` braucht und `rohabzug.ts` sonst `nachlauf.ts` importieren
 * müsste, das seinerseits `rohabzug.ts` importiert.
 */
import { query } from '../db/pool'
import type { TpapiAntwort } from './client'
import type { TpapiModul } from './endpunkte'

/** Wie lange ein „not licensed" gilt, bevor wieder gefragt wird (D7). */
export const LIZENZ_PAUSE_TAGE = 7

export type ZugangZustand = 'ok' | 'nicht_lizenziert' | 'abgewiesen' | 'gebremst' | 'fehler'

/**
 * Die Schlüssel der Umgebung in `sync.tpapi_zugang` spiegeln, für EIN Modul
 * (Plan Stufe 1 §3.3).
 *
 * Je Schlüssel eine Zeile, Betrieb über `core.betrieb.enc_id`. Eine encId
 * ohne Betrieb wird zurückgegeben — sie macht den Lauf `teilweise`, weil ein
 * Schlüssel, der nie benutzt wird, sonst nur im Log stünde. Ein weggefallener
 * Schlüssel setzt `ohne_schluessel`; damit fällt der Betrieb aus den
 * Rückstandssichten, statt dort für immer als Rückstand zu stehen.
 *
 * Ein Schlüssel, der WIEDERKOMMT, setzt den Zustand auf `ok` zurück — mehr
 * weiß man über ihn nicht, und der erste Aufruf dieser Nacht schreibt den
 * echten Ausgang.
 */
export async function zugangSpiegeln(encIds: string[], modul: TpapiModul = 'personal'): Promise<{ ohneBetrieb: string[] }> {
  await query(
    `INSERT INTO sync.tpapi_zugang
       (betrieb_key, modul, enc_id, schluessel_vorhanden, zustand, aktualisiert_am)
     SELECT b.betrieb_key, $2, b.enc_id, true, 'ok', now()
       FROM core.betrieb b
      WHERE b.enc_id = ANY($1::text[])
     ON CONFLICT (betrieb_key, modul) DO UPDATE SET
       enc_id               = excluded.enc_id,
       schluessel_vorhanden = true,
       zustand              = CASE WHEN sync.tpapi_zugang.zustand = 'ohne_schluessel'
                                   THEN 'ok' ELSE sync.tpapi_zugang.zustand END,
       aktualisiert_am      = CASE WHEN sync.tpapi_zugang.schluessel_vorhanden
                                    AND sync.tpapi_zugang.enc_id = excluded.enc_id
                                   THEN sync.tpapi_zugang.aktualisiert_am ELSE now() END`,
    [encIds, modul])

  await query(
    `UPDATE sync.tpapi_zugang z
        SET schluessel_vorhanden = false, zustand = 'ohne_schluessel', aktualisiert_am = now()
      WHERE z.modul = $2
        AND (z.schluessel_vorhanden OR z.zustand <> 'ohne_schluessel')
        AND NOT EXISTS (SELECT 1 FROM core.betrieb b
                         WHERE b.betrieb_key = z.betrieb_key AND b.enc_id = ANY($1::text[]))`,
    [encIds, modul])

  const fehlt = await query<{ enc_id: string }>(
    `SELECT e AS enc_id FROM unnest($1::text[]) AS e
      WHERE NOT EXISTS (SELECT 1 FROM core.betrieb b WHERE b.enc_id = e)
      ORDER BY 1`, [encIds])
  return { ohneBetrieb: fehlt.map(f => f.enc_id) }
}

/**
 * Der Ausgang eines Aufrufs nach `sync.tpapi_zugang`, für Betrieb UND Modul.
 * Fehlertext gekürzt und gesäubert — `saeubern` ist `client.sauber`.
 */
export async function zugangFortschreiben(
  betriebKey: number, modul: TpapiModul, a: Pick<TpapiAntwort, 'status'>, zustand: ZugangZustand,
  fehler: string | null, saeubern: (t: string) => string,
): Promise<void> {
  await query(
    `UPDATE sync.tpapi_zugang SET
       zustand            = $3,
       zuletzt_gefragt_am = now(),
       zuletzt_erfolg_am  = CASE WHEN $3 = 'ok' THEN now() ELSE zuletzt_erfolg_am END,
       letzter_http       = $4,
       letzter_fehler     = $5,
       aktualisiert_am    = now()
     WHERE betrieb_key = $1 AND modul = $2`,
    [betriebKey, modul, zustand, a.status === 0 ? null : a.status,
     fehler === null ? null : saeubern(fehler).slice(0, 200)])
}
