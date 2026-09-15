/**
 * Was der Server bis zum 15.09.2026 NICHT protokollierte: gescheiterte Aufrufe.
 *
 * ANLASS: das Werkzeug `datenstand` lief aus ChatGPT in die 20-Sekunden-
 * Grenze der Leserolle. Skybridge macht aus der Ausnahme eine Werkzeugantwort
 * mit isError — das Modell sah den Fehler, mcp.zugriff nicht. /status meldete
 * danach "0 Aufrufe", und die Suche nach der Ursache begann ohne jede Spur.
 * Ein Protokoll, das nur die gelungenen Aufrufe kennt, ist keins.
 *
 * WAS HIER PROTOKOLLIERT WIRD UND WAS NICHT. Nur Aufrufe, die mit einer
 * Ausnahme endeten und noch KEINEN Eintrag haben. Der Abfrageweg
 * (ausfuehren.ts) schreibt seine Sperren und Datenbankfehler selbst — mit
 * SQL, Sichten und Befunden, die hier nicht mehr vorliegen — und markiert die
 * Ausnahme als protokolliert (istProtokolliert). Gelungene Aufrufe schreibt
 * jedes Werkzeug selbst, weil nur es weiss, wie viele Zeilen es waren.
 *
 * DER NUTZER KOMMT AUS DEM TOKEN, NICHT AUS mcp.nutzer: anmelden() kann
 * selbst der Grund des Scheiterns sein (Konto gesperrt), und ein zweiter
 * Datenbankgang fuer den Eintrag ueber einen Fehler waere die falsche
 * Reihenfolge. Ohne Token bleibt subject NULL — auch das ist eine Auskunft:
 * jemand ruft Werkzeuge ohne Anmeldung auf.
 *
 * WARUM MIDDLEWARE UND KEIN try/catch JE WERKZEUG: Skybridge faengt die
 * Ausnahme des Handlers selbst und legt sie fuer Middleware unter `extra`
 * ab (getToolError). Zehn try/catch-Bloecke waeren zehn Stellen, an denen
 * das naechste Werkzeug den Eintrag vergisst — genau die Luecke, die hier
 * geschlossen wird.
 */
import { getToolError } from 'skybridge/server'
import { anzeigeAus, subjektAus } from './auth'
import { istProtokolliert, protokollieren } from './ausfuehren'

type Anfrage = { method: string; params: Record<string, unknown> }

export async function gescheiterteAufrufeProtokollieren<T>(
  request: Anfrage, extra: any, next: () => Promise<T>,
): Promise<T> {
  const start = Date.now()
  const ergebnis = await next()

  const fehler = getToolError(extra)
  if (fehler === undefined || istProtokolliert(fehler)) return ergebnis

  const f = fehler as { name?: string; message?: string } | null
  const text = f !== null && typeof f === 'object'
    ? `${f.name ?? 'Fehler'}: ${f.message ?? String(fehler)}`
    : String(fehler)

  // protokollieren() wirft nie — ein missglueckter Eintrag darf die Antwort
  // an das Modell nicht auch noch verschlucken.
  await protokollieren({
    nutzer: {
      subject: subjektAus(extra),
      anzeige: anzeigeAus(extra),
      client: extra?.http?.authInfo?.clientId ?? null,
    },
    werkzeug: String(request.params?.name ?? '?'),
    parameter: request.params?.arguments,
    dauer_ms: Date.now() - start,
    fehler: text,
  })
  return ergebnis
}
