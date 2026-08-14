/**
 * Hält den Container am Leben und macht ihn für Dokploy sichtbar.
 *
 * Der Importer ist kein Webservice — aber Dokploy Schedule Jobs führen
 * Kommandos per `docker exec` in einem LAUFENDEN Container aus, sie starten
 * keinen neuen. Der Container braucht also einen Prozess, der oben bleibt.
 * Statt `sleep infinity` ein winziger HTTP-Endpunkt: damit funktionieren
 * Dokploys Health-Checks und Monitoring, und man sieht von außen, wann der
 * letzte Lauf war.
 *
 * Der eigentliche Sync läuft als eigener Prozess (`bun run sync`) und startet
 * bei jedem Lauf frisch — keine wochenlang laufenden Scheduler, keine
 * Speicherlecks, und ein Absturz kostet nur den laufenden Lauf.
 */
import { config } from './config'
import { eine } from './db/pool'
import { statusErheben } from './status'

type Zustand = {
  status: 'ok' | 'veraltet' | 'unbekannt' | 'db_nicht_erreichbar'
  letzterLauf: { laufId: string; status: string; beendetAm: string | null } | null
  offeneAbweichungen: number
  pausierteKombinationen: number
  offeneWarteschlange: number
}

async function erheben(): Promise<Zustand> {
  // ORDER BY steht bewusst auf `lauf_id DESC` OHNE Alias-Bezug: hiesse die
  // Ausgabespalte ebenfalls `lauf_id`, löste Postgres den ORDER BY gegen den
  // TEXT auf und sortierte alphabetisch — 9 vor 71. Genau das war bis zum
  // 04.08.2026 der Fall und liess /health monatelang einen falschen „letzten
  // Lauf" melden (und damit ein falsches `veraltet`).
  // Uebersprungene und gesperrte Starts (0081) zaehlen hier nicht: ein Tag
  // voller Skips hielte "veraltet" sonst ewig gruen, waehrend der Import steht.
  const lauf = await eine<any>(
    `SELECT lauf_id::text AS lauf_id_text, status, beendet_am
       FROM sync.lauf
      WHERE status NOT IN ('uebersprungen','gesperrt')
      ORDER BY lauf_id DESC LIMIT 1`)
  const abw = await eine<any>(
    `SELECT count(*)::int AS n FROM sync.schema_abweichung WHERE quittiert_am IS NULL`)
  const pausiert = await eine<any>(
    `SELECT count(*)::int AS n FROM sync.fortschritt WHERE pausiert_bis > now()`)
  const offen = await eine<any>(
    `SELECT count(*)::int AS n FROM sync.warteschlange WHERE erledigt_am IS NULL`)

  // "veraltet" = seit über 36 Stunden kein abgeschlossener Lauf. Bei einem
  // täglichen Sync heißt das: mindestens ein Lauf ist ausgefallen.
  const veraltet = !lauf?.beendet_am ||
    Date.now() - new Date(lauf.beendet_am).getTime() > 36 * 3600 * 1000

  return {
    status: !lauf ? 'unbekannt' : veraltet ? 'veraltet' : 'ok',
    letzterLauf: lauf
      ? { laufId: lauf.lauf_id_text, status: lauf.status, beendetAm: lauf.beendet_am?.toISOString?.() ?? null }
      : null,
    offeneAbweichungen: abw?.n ?? 0,
    pausierteKombinationen: pausiert?.n ?? 0,
    offeneWarteschlange: offen?.n ?? 0,
  }
}

Bun.serve({
  port: config.PORT,
  async fetch(req) {
    const pfad = new URL(req.url).pathname

    if (pfad === '/health') {
      try {
        // 200 auch bei "veraltet": ein verpasster Sync ist kein Grund, den
        // Container neu zu starten — das würde das Problem nicht lösen.
        return Response.json(await erheben())
      } catch (e) {
        return Response.json({ status: 'db_nicht_erreichbar', fehler: String(e) }, { status: 503 })
      }
    }

    /**
     * Der Endpunkt fürs Monitoring — die Frage „muss jemand hinsehen?".
     *
     * Bewusst NICHT `/health`. Der ist der Container-Health-Check und darf nur
     * rot werden, wenn ein Neustart hilft. Bei einer Zugangssperre hilft er
     * nicht, er macht es schlimmer: Dokploy drehte den Container im Kreis,
     * während LINA ohnehin gerade nichts von uns hören will.
     *
     * Hier dagegen ist 503 richtig — ein Uptime-Monitor schlägt an, ein Mensch
     * sieht nach, und niemand startet etwas neu. `warnung` bleibt bei 200:
     * Dinge, die man wissen sollte, wecken niemanden nachts.
     */
    if (pfad === '/status') {
      try {
        const bericht = await statusErheben()
        return Response.json(bericht, { status: bericht.status === 'stoerung' ? 503 : 200 })
      } catch (e) {
        return Response.json(
          { status: 'stoerung', pruefungen: [{ name: 'datenbank', stufe: 'stoerung',
            meldung: 'Datenbank nicht erreichbar', werte: { fehler: String(e).slice(0, 300) } }] },
          { status: 503 })
      }
    }

    return new Response('cf-analytics importer', { status: 200 })
  },
})

console.log(JSON.stringify({ t: new Date().toISOString(), stufe: 'info',
  msg: 'health lauscht', port: config.PORT, tz: process.env.TZ }))
