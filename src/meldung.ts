/**
 * Die Statusmeldung in den Channel — nach jedem Nachtlauf, und wenn er ausbleibt.
 *
 * Entscheidung Eugene, 04.11.2026: statt `/status` von außen erreichbar zu
 * machen, kommt die Antwort auf „muss jemand hinsehen?" als Nachricht in einen
 * kChat-Channel (Infomaniak, dahinter Mattermost). Ein Endpunkt muss jemand
 * aufrufen; eine Nachricht kommt von selbst — und eine, die jeden Morgen kommt,
 * fällt auf, wenn sie einmal fehlt.
 *
 * DIESELBEN PRÜFUNGEN WIE `/status`. Die Nachricht rechnet nichts Eigenes; sie
 * formatiert `statusErheben()` für Menschen. Zwei Wahrheiten über den Zustand
 * des Systems wären eine zu viel.
 *
 * ZWEI AUSLÖSER:
 *   laufMelden()    am Ende von `bun run sync` — auch beim Abbruch
 *   ausfallMelden() stündlich aus `health.ts`: kein abgeschlossener Lauf seit
 *                   STATUS_AUSFALL_STUNDEN. Den Fall kann der Lauf nicht selbst
 *                   melden — er findet ja nicht statt (Regel 10).
 *
 * WIRFT NIE. Eine Meldung, die nicht ankommt, darf den Lauf nicht scheitern
 * lassen; sie landet als Warnung im Log. Die URL wird nie geloggt.
 */
import { config } from './config'
import { eine, query } from './db/pool'
import { log } from './lib/log'
import { statusErheben, type Pruefung, type Statusbericht, type Stufe } from './status'

/** Was der Mensch liest, je Prüfung in `src/status.ts`. Unbekannte Namen erscheinen roh. */
const BEZEICHNUNG: Record<string, string> = {
  zugang: 'LINA-Zugang',
  fortschritt: 'Fortschritt',
  laeufe: 'Läufe',
  aufgegebene_posten: 'Aufgegebene Abrufe',
  zulauf: 'Zulauf der Quellen',
  schema: 'Antwortformat der Quellen',
  bwa_bruecke: 'BWA-Zuordnung',
  bwa_fortschritt: 'BWA',
  dashboard_filter: 'Dashboard-Filter',
  materialisierung: 'Auswertungen aufgefrischt',
  yext: 'Bewertungen (Yext)',
  bounti: 'Schulungen (Bounti)',
  mcp: 'Chat-Zugang (MCP)',
  luecken: 'Datenlücken',
  speicher: 'Speicherplatz',
  datenbank: 'Datenbank',
}

const ZEICHEN: Record<Stufe, string> = { ok: '✅', warnung: '⚠️', stoerung: '🔴' }

export type LaufKopf = {
  laufId: string
  status: string
  gestartetAm: Date
  beendetAm: Date | null
  ableitungenBis: Date | null
  aufgabenOk: number
  aufgabenFehler: number
}

// --- Formatierung -----------------------------------------------------------

const ZONE = 'Europe/Berlin'
const uhr = (d: Date) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(d)
const tag = (d: Date) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: ZONE, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
const zahl = (n: number) => new Intl.NumberFormat('de-DE').format(n)

function dauer(von: Date, bis: Date): string {
  const min = Math.round((bis.getTime() - von.getTime()) / 60000)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

/** Eine Tabellenzelle darf weder `|` noch einen Zeilenumbruch enthalten. */
const zelle = (t: string) => t.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ')

/** SQL im nächsten Schritt als Code setzen, damit man es kopieren kann. */
function schrittSetzen(t: string): string {
  return zelle(t).replace(/(SELECT\b[^;]*;)/g, '`$1`')
}

const name = (p: Pruefung) => BEZEICHNUNG[p.name] ?? p.name

// --- Die Nachricht ----------------------------------------------------------

export type NachrichtEingabe = {
  lauf: LaufKopf | null
  bericht: Statusbericht
  /** `name:stufe` der Befunde aus der letzten Nachricht — was dort fehlt, ist neu. */
  vorher: string[]
  /** Fehlertext, wenn der Lauf mit einer Ausnahme endete. */
  fehler?: string
  test?: boolean
}

export const befundSchluessel = (p: Pruefung) => `${p.name}:${p.stufe}`

/** Rein: aus Lauf und Statusbericht wird Markdown für Mattermost. Getestet in meldung.test.ts. */
export function nachrichtBauen(e: NachrichtEingabe): string {
  const { lauf, bericht } = e
  const befunde = bericht.pruefungen.filter(p => p.stufe !== 'ok')
    .sort((a, b) => (a.stufe === b.stufe ? 0 : a.stufe === 'stoerung' ? -1 : 1))
  const ok = bericht.pruefungen.filter(p => p.stufe === 'ok')
  const abgebrochen = Boolean(e.fehler) || lauf?.status === 'abgebrochen' || lauf?.status === 'fehlgeschlagen'
  const stufe: Stufe = abgebrochen ? 'stoerung' : bericht.status

  const titel = abgebrochen
    ? `Nachtlauf ${lauf?.laufId ?? ''} abgebrochen`.replace('  ', ' ')
    : stufe === 'ok'
      ? `Nachtlauf ${lauf?.laufId ?? ''} · alles in Ordnung`
      : stufe === 'stoerung'
        ? `Nachtlauf ${lauf?.laufId ?? ''} · Störung, bitte ansehen`
        : `Nachtlauf ${lauf?.laufId ?? ''} · ${befunde.length} ${befunde.length === 1 ? 'Hinweis' : 'Hinweise'}`

  const z: string[] = [`#### ${ZEICHEN[stufe]} ${titel}`]
  if (e.test) z.push('_Testnachricht, von Hand ausgelöst._')

  if (lauf) {
    const teile = [tag(lauf.gestartetAm)]
    teile.push(lauf.beendetAm
      ? `${uhr(lauf.gestartetAm)}–${uhr(lauf.beendetAm)} Uhr (${dauer(lauf.gestartetAm, lauf.beendetAm)})`
      : `seit ${uhr(lauf.gestartetAm)} Uhr`)
    if (lauf.ableitungenBis) teile.push(`Dashboards aktuell seit ${uhr(lauf.ableitungenBis)} Uhr`)
    z.push(teile.join(' · '))
    const abrufe = [`${zahl(lauf.aufgabenOk)} Abrufe erfolgreich`]
    if (lauf.aufgabenFehler > 0) {
      abrufe.push(`${zahl(lauf.aufgabenFehler)} fehlgeschlagen — der nächste Lauf versucht sie erneut`)
    }
    z.push(abrufe.join(' · '))
  }

  if (e.fehler) {
    z.push('', `**Der Lauf endete mit einem Fehler:** \`${zelle(e.fehler).slice(0, 300)}\``,
      'Der nächste Lauf schließt ihn als abgebrochen und macht weiter, wo dieser aufgehört hat. '
      + 'Schlägt auch er fehl, im Dokploy-Log des Schedule Jobs nachsehen.')
  }

  if (befunde.length > 0) {
    z.push('', '| | Bereich | Befund |', '|:-:|:--|:--|')
    for (const p of befunde) {
      const neu = e.vorher.includes(befundSchluessel(p)) ? '' : ' 🆕'
      z.push(`| ${ZEICHEN[p.stufe]}${neu} | **${name(p)}** | ${zelle(p.meldung)} |`)
    }
    const schritte = befunde.filter(p => p.naechster_schritt)
    if (schritte.length > 0) {
      z.push('', '**Was zu tun ist**')
      for (const p of schritte) z.push(`- **${name(p)}:** ${schrittSetzen(p.naechster_schritt!)}`)
    }
  }

  if (ok.length > 0) {
    z.push('', `${ZEICHEN.ok} ${ok.map(name).join(' · ')}`)
  }
  if (befunde.length > 0) {
    z.push('', '_🆕 = in der letzten Meldung noch nicht dabei._')
  }
  return z.join('\n')
}

// --- Versand ------------------------------------------------------------------

async function senden(text: string): Promise<boolean> {
  const url = config.STATUS_WEBHOOK_URL
  if (!url) return false
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, username: 'Concept Family Analytics' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) {
      log.warn('statusmeldung abgelehnt', { http: r.status, antwort: (await r.text()).slice(0, 200) })
      return false
    }
    return true
  } catch (e) {
    log.warn('statusmeldung nicht gesendet', { fehler: String(e).slice(0, 200) })
    return false
  }
}

async function laufKopf(laufId: string | null): Promise<LaufKopf | null> {
  const r = await eine<any>(
    `SELECT l.lauf_id::text AS lauf_id, l.status, l.gestartet_am, l.beendet_am, l.ableitungen_bis,
            coalesce(s.aufgaben_ok, 0)::int AS ok, coalesce(s.aufgaben_fehler, 0)::int AS fehler
       FROM sync.lauf l
       LEFT JOIN mart.sync_status s USING (lauf_id)
      WHERE ($1::bigint IS NULL AND l.status NOT IN ('uebersprungen', 'gesperrt')) OR l.lauf_id = $1::bigint
      ORDER BY l.lauf_id DESC LIMIT 1`, [laufId])
  if (!r) return null
  return {
    laufId: r.lauf_id, status: r.status,
    gestartetAm: new Date(r.gestartet_am),
    beendetAm: r.beendet_am ? new Date(r.beendet_am) : null,
    ableitungenBis: r.ableitungen_bis ? new Date(r.ableitungen_bis) : null,
    aufgabenOk: r.ok, aufgabenFehler: r.fehler,
  }
}

const MERKER = 'status_meldung'

/**
 * Nach dem Lauf melden. `laufId` null = der jüngste echte Lauf (für den
 * Handaufruf). Übersprungene Starts melden nichts — sie sind kein Lauf.
 */
export async function laufMelden(laufId: string | null, opt: { fehler?: unknown; test?: boolean } = {}): Promise<boolean> {
  if (!config.STATUS_WEBHOOK_URL) return false
  try {
    const lauf = await laufKopf(laufId)
    if (lauf?.status === 'uebersprungen') return false
    const bericht = await statusErheben()
    const m = await eine<{ wert: any }>(`SELECT wert FROM sync.merker WHERE schluessel = $1`, [MERKER])
    const vorher: string[] = Array.isArray(m?.wert?.befunde) ? m!.wert.befunde : []
    const text = nachrichtBauen({
      lauf, bericht, vorher, test: opt.test,
      fehler: opt.fehler === undefined ? undefined : String(opt.fehler),
    })
    const gesendet = await senden(text)
    if (gesendet && !opt.test) {
      const befunde = bericht.pruefungen.filter(p => p.stufe !== 'ok').map(befundSchluessel)
      await query(
        `INSERT INTO sync.merker (schluessel, wert) VALUES ($1, $2::jsonb)
         ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`,
        [MERKER, JSON.stringify({ lauf_id: lauf?.laufId ?? null, befunde, status: bericht.status })])
    }
    if (gesendet) log.info('statusmeldung gesendet', { laufId: lauf?.laufId, status: bericht.status })
    return gesendet
  } catch (e) {
    log.warn('statusmeldung gescheitert', { fehler: String(e).slice(0, 200) })
    return false
  }
}

const MERKER_AUSFALL = 'status_meldung_ausfall'

/**
 * Bleibt der Nachtlauf aus, meldet ihn niemand — außer diesem Wächter. Er läuft
 * stündlich im Container (`health.ts`) und meldet einmal je ausgebliebenem
 * Lauf: der Merker hält fest, zu welchem letzten Lauf schon gemeldet wurde.
 * Ein Lauf, der seit über STATUS_AUSFALL_STUNDEN arbeitet, zählt ebenso — er
 * hängt.
 *
 * GEMESSEN WIRD AB DEM ENDE DES TAGESGESCHÄFTS, nicht ab dem Laufende (seit
 * 19.11.2026). Lauf 206 lud bis 04:30 nach, der Start 207 um 04:00 wurde
 * übersprungen — und ab `beendet_am` gerechnet war der jüngste Lauf ganze
 * Minuten alt: der Wächter hätte nie gemeldet, obwohl das Tagesgeschäft
 * 22 Stunden zurücklag und erst 46 Stunden später wiederkam. Was die
 * Dashboards frisch hält, ist `tagesgeschaeft_bis` (`0116`); ein Lauf, der
 * danach bis zum Morgen nachlädt, ist dafür ohne Belang. Für Läufe ohne den
 * Stempel (abgebrochen in Phase A, vor `0116`) bleibt es `beendet_am`.
 */
export async function ausfallMelden(): Promise<boolean> {
  if (!config.STATUS_WEBHOOK_URL) return false
  try {
    const l = await eine<any>(
      `SELECT l.lauf_id::text AS lauf_id, l.status, l.gestartet_am, l.beendet_am, l.tagesgeschaeft_bis,
              round(EXTRACT(epoch FROM now() - CASE WHEN l.beendet_am IS NULL THEN l.gestartet_am
                                                     ELSE coalesce(l.tagesgeschaeft_bis, l.beendet_am) END)
                    / 3600, 1)::float AS stunden,
              (SELECT count(*) FROM sync.lauf u
                WHERE u.lauf_id > l.lauf_id AND u.status = 'uebersprungen')::int AS uebersprungen
         FROM sync.lauf l
        WHERE l.status NOT IN ('uebersprungen', 'gesperrt')
        ORDER BY l.lauf_id DESC LIMIT 1`)
    if (!l || Number(l.stunden) < config.STATUS_AUSFALL_STUNDEN) return false
    const m = await eine<{ wert: any }>(`SELECT wert FROM sync.merker WHERE schluessel = $1`, [MERKER_AUSFALL])
    if (m?.wert?.lauf_id === l.lauf_id) return false

    const haengt = !l.beendet_am
    const text = [
      haengt
        ? `#### 🔴 Nachtlauf ${l.lauf_id} hängt — seit ${zahl(Math.round(l.stunden))} Stunden nicht fertig`
        : `#### 🔴 Kein Tagesgeschäft seit ${zahl(Math.round(l.stunden))} Stunden`,
      haengt
        ? `Gestartet ${tag(new Date(l.gestartet_am))}, ${uhr(new Date(l.gestartet_am))} Uhr. Die Dashboards zeigen bis dahin den alten Stand.`
        : (l.tagesgeschaeft_bis
            ? `Der letzte Lauf (${l.lauf_id}) hat das Tagesgeschäft ${tag(new Date(l.tagesgeschaeft_bis))}, ${uhr(new Date(l.tagesgeschaeft_bis))} Uhr abgeschlossen und endete ${tag(new Date(l.beendet_am))}, ${uhr(new Date(l.beendet_am))} Uhr, Status „${l.status}".`
            : `Der letzte Lauf (${l.lauf_id}) endete ${tag(new Date(l.beendet_am))}, ${uhr(new Date(l.beendet_am))} Uhr, Status „${l.status}".`)
          + (l.uebersprungen > 0
              ? ` Danach ${l.uebersprungen === 1 ? 'wurde ein Start' : `wurden ${zahl(l.uebersprungen)} Starts`} übersprungen, weil die Laufsperre belegt war — die Dashboards altern still.`
              : ' Seitdem ist keiner gestartet — die Dashboards altern still.'),
      '',
      '**Was zu tun ist**',
      haengt
        ? '- In Dokploy im Importer-Container nachsehen, ob `bun run src/sync.ts` noch arbeitet (`pgrep -f sync.ts`). Ein Deploy während des Laufs beendet ihn ohne Meldung; der nächste Start schließt ihn dann als abgebrochen.'
        : l.uebersprungen > 0
          ? '- Ein übersprungener Start heißt: der Lauf davor lud noch nach. `NACHLADEN_BIS` (Ortszeit) muss vor dem Start des Schedule Jobs liegen — der Job läuft in UTC und startet im Winter eine Stunde früher. Läuft gerade kein Lauf, `bun run sync` im Importer-Container von Hand starten.'
          : '- In Dokploy den Schedule Job `bun run sync` des Importers prüfen: aktiv? letzte Ausführung? Notfalls dort von Hand starten.',
      '- Danach kommt die gewohnte Meldung nach dem Lauf.',
    ].join('\n')
    const gesendet = await senden(text)
    if (gesendet) {
      await query(
        `INSERT INTO sync.merker (schluessel, wert) VALUES ($1, jsonb_build_object('lauf_id', $2::text))
         ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`,
        [MERKER_AUSFALL, l.lauf_id])
      log.warn('ausfallmeldung gesendet', { laufId: l.lauf_id, stunden: l.stunden })
    }
    return gesendet
  } catch (e) {
    log.warn('ausfallmeldung gescheitert', { fehler: String(e).slice(0, 200) })
    return false
  }
}

// --- Handaufruf: `bun run status-melden` --------------------------------------
if (import.meta.main) {
  const { pool } = await import('./db/pool')
  if (!config.STATUS_WEBHOOK_URL) {
    console.log('STATUS_WEBHOOK_URL ist nicht gesetzt — nichts gesendet.')
  } else {
    const ok = await laufMelden(null, { test: true })
    console.log(ok ? 'Testnachricht gesendet.' : 'Nicht gesendet — Grund steht oben im Log.')
  }
  await pool.end().catch(() => {})
}
