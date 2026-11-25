/**
 * Kostenstellen ohne Warenwirtschaft (0164).
 *
 * FoodNotify antwortet für eine erpId, deren Warenwirtschaft es nicht mehr
 * gibt, mit HTTP 200 und der Hülle „No Erp Found!" — gemessen an neun
 * Kostenstellen seit dem 12./13.11.2026 (Aposto Augsburg, Aposto Aachen Alte
 * Post, Riegele Wirtshaus, Aposto Münster, Service Enchilada Rosenheim), vorher
 * lieferten alle normal. Bis 0164 lief das in den gewöhnlichen Fehlerpfad:
 * jede Nacht rund 50 neue Posten, nach drei Wiederbelebungen „endgültig
 * aufgegeben — diese Zeiträume fehlen dauerhaft". Gefehlt hat nichts, die
 * Quelle hat die Frage beantwortet.
 *
 * Jetzt: die Kostenstelle wird markiert (core.kostenstelle.erp_fehlt_seit),
 * der Posten schließt als 'erp_fehlt', und der Einreihweg fragt sie nur noch
 * einmal je FN_ERP_FEHLT_PROBE_TAGE ab. Liefert ein Abruf mit dieser erpId
 * wieder, ist die Markierung weg. Sichtbar in mart.kostenstelle_ohne_erp
 * (Regel 10: stillgelegt heißt sichtbar, nicht still).
 */
import { query } from '../db/pool'

/** Erkennt die Hüllenmeldung — Groß/Klein und Satzzeichen sind FoodNotifys Sache. */
export function istErpFehlt(fehler: string | null | undefined): boolean {
  return /no erp found/i.test(fehler ?? '')
}

function erpIdAus(parameter: Record<string, unknown> | null | undefined): number | null {
  const v = parameter?.erpId
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Markiert die Kostenstelle und schließt den Posten als 'erp_fehlt'. */
export async function erpFehltVerbuchen(postenId: number, markeKey: number,
                                        parameter: Record<string, unknown> | null | undefined,
                                        fehler: string): Promise<boolean> {
  const erpId = erpIdAus(parameter)
  if (erpId === null) return false
  await query(
    `UPDATE core.kostenstelle
        SET erp_fehlt_seit = coalesce(erp_fehlt_seit, now()), erp_fehlt_zuletzt = now()
      WHERE marke_key = $1 AND erp_id = $2`, [markeKey, erpId])
  await query(
    `UPDATE sync.warteschlange
        SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'erp_fehlt', letzter_fehler = $2
      WHERE posten_id = $1`, [postenId, fehler.slice(0, 2000)])
  return true
}

/** Ein Erfolg mit dieser erpId hebt die Markierung auf. Ohne erpId: nichts. */
export async function erpFehltAufheben(markeKey: number,
                                       parameter: Record<string, unknown> | null | undefined): Promise<void> {
  const erpId = erpIdAus(parameter)
  if (erpId === null) return
  await query(
    `UPDATE core.kostenstelle SET erp_fehlt_seit = NULL, erp_fehlt_zuletzt = NULL
      WHERE marke_key = $1 AND erp_id = $2 AND erp_fehlt_seit IS NOT NULL`, [markeKey, erpId])
}
