/**
 * Praxislauf Rezepturen: der ECHTE Ladepfad (FnClient → fnLaden → raw → core)
 * NUR für FoodNotify-Rezepte, gegen eine LOKALE Datenbank.
 *
 *   bun run rezepte-praxis --datenbank postgresql://localhost/lina_rezept_1015
 *   bun run rezepte-praxis --datenbank postgresql://localhost/lina_rezept_1015 --marke wilma_wunder --max-rezepte 200
 *
 * WOZU: vor dem Push von 0132 einmal wirklich laden — mit FoodNotifys echten
 * Antworten, aber ohne den Nachtlauf, ohne Produktion und ohne Nebenwirkungen
 * auf andere Quellen.
 *
 * WAS ES ABSICHERT:
 *   * Die Datenbank muss ausdrücklich angegeben werden und auf localhost /
 *     127.0.0.1 / ::1 zeigen; der Server muss das bestätigen
 *     (inet_server_addr() leer oder Loopback). Sonst Abbruch vor allem anderen.
 *   * Kein LINA, kein Yext, kein Bounti, kein Wetter: es gibt hier keinen
 *     Client dafür. Gezogen werden NUR Posten mit endpunkt LIKE 'fn:rezept%'
 *     der gewählten Marken — auch wenn die Schlange der Klon-Datenbank fremde
 *     Posten trägt, bleiben sie liegen.
 *   * Dieselbe Laufsperre wie der Worker (pg_try_advisory_lock): läuft auf
 *     derselben Datenbank ein Sync, startet der Praxislauf nicht.
 *   * Anmeldung: FnClient, je Marke höchstens ein Versuch. Ein Anmeldefehler
 *     beendet den ganzen Praxislauf (AGENTS.md Regel 7). Takt und
 *     Tagesbudget wie im Importer (FN_TAKT_*, FN_TAGESBUDGET).
 *   * Nach ABBRUCH_NACH_FEHLERN Fehlern in Folge ist Schluss.
 *
 * Eingereiht wird mit rezepteNachfuellen() — derselben Funktion wie im
 * Nachtlauf, auf die gewählten Marken beschränkt. Abgearbeitet wird erst das
 * Tagesgeschäft (nachladen = false), dann das Nachladen. `--max-rezepte N`
 * hört nach N geladenen Zutatenlisten auf; der Rest bleibt in der Schlange
 * der lokalen Datenbank stehen und wird beim nächsten Praxislauf fortgesetzt.
 */

export const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Wirft, wenn die URL nicht ausdrücklich auf diesen Rechner zeigt. */
export function datenbankPruefen(url: string | undefined): string {
  if (!url) throw new Error('--datenbank fehlt. Der Praxislauf nimmt nie stillschweigend DATABASE_URL aus der .env.')
  let u: URL
  try { u = new URL(url) } catch { throw new Error('--datenbank ist keine gültige postgresql://-Adresse') }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('--datenbank muss mit postgresql:// beginnen')
  if (!LOOPBACK.has(u.hostname)) {
    throw new Error(`--datenbank zeigt auf "${u.hostname}", nicht auf localhost — Abbruch. `
      + 'Der Praxislauf schreibt raw und core; er läuft nur gegen eine lokale Datenbank.')
  }
  if (u.searchParams.has('host')) throw new Error('--datenbank mit host=-Parameter ist nicht erlaubt')
  return url
}

export type PraxisErgebnis = {
  laufId: string
  posten: number
  ok: number
  fehler: number
  nichtGefunden: number
  zutatenGeladen: number
  offen: number
  grund: string
}

export async function rezeptePraxis(o: {
  datenbank: string; marken?: string[]; maxRezepte?: number; ausgabe?: (z: string) => void
}): Promise<PraxisErgebnis> {
  const aus = o.ausgabe ?? ((z: string) => console.log(z))
  datenbankPruefen(o.datenbank)
  const { config, fnZugaenge } = await import('./config')
  if (config.DATABASE_URL !== o.datenbank) {
    throw new Error('config.DATABASE_URL weicht von --datenbank ab — Abbruch, bevor irgendetwas geschrieben wird.')
  }
  const { query, eine } = await import('./db/pool')
  const server = await eine<{ addr: string | null }>(`SELECT host(inet_server_addr()) AS addr`)
  if (server?.addr && !['127.0.0.1', '::1'].includes(server.addr)) {
    throw new Error(`Der Datenbankserver meldet die Adresse ${server.addr} — kein Loopback, Abbruch.`)
  }

  const zugaenge = fnZugaenge()
  const marken = o.marken?.length ? o.marken : zugaenge.map(z => z.schluessel)
  const ohne = marken.filter(m => !zugaenge.some(z => z.schluessel === m))
  if (ohne.length) throw new Error(`Keine FN_*-Zugangsdaten für: ${ohne.join(', ')}`)
  const keyZuMarke = new Map<number, string>()
  for (const m of marken) {
    const r = await eine<{ marke_key: number }>(`SELECT marke_key FROM core.marke WHERE schluessel = $1`, [m])
    if (!r) throw new Error(`Marke ${m} fehlt in core.marke`)
    keyZuMarke.set(Number(r.marke_key), m)
  }
  const keys = [...keyZuMarke.keys()]

  const { sperreHolen } = await import('./sync/worker')
  const sperre = await sperreHolen()
  if (!sperre.frei) throw new Error('Auf dieser Datenbank läuft ein Sync (Laufsperre belegt) — kein Praxislauf.')

  const { FnClient } = await import('./foodnotify/client')
  const { fnEndpunkt } = await import('./foodnotify/endpunkte')
  const { fnLaden, rezeptNichtGefunden } = await import('./foodnotify/laden')
  const { rezepteNachfuellen } = await import('./sync/nachfuellen')

  const lauf = await eine<{ lauf_id: string }>(
    `INSERT INTO sync.lauf (ausloeser, notiz) VALUES ('manuell', $1) RETURNING lauf_id::text`,
    [`Praxislauf Rezepturen: ${marken.join(', ')}${o.maxRezepte ? `, max ${o.maxRezepte} Rezepte` : ''}`])
  const laufId = lauf!.lauf_id
  const e: PraxisErgebnis = { laufId, posten: 0, ok: 0, fehler: 0, nichtGefunden: 0, zutatenGeladen: 0, offen: 0, grund: '' }
  let abbruch = false
  const signal = () => { abbruch = true }
  process.on('SIGINT', signal)
  process.on('SIGTERM', signal)

  try {
    const eingereiht = await rezepteNachfuellen(false, marken)
    aus(`eingereiht: ${JSON.stringify({ ...eingereiht, jeMarke: undefined })}`)

    const client = new FnClient()
    await client.budgetLaden()
    let inFolge = 0

    while (true) {
      if (abbruch) { e.grund = 'Signal'; break }
      if (o.maxRezepte && e.zutatenGeladen >= o.maxRezepte) { e.grund = `--max-rezepte ${o.maxRezepte} erreicht`; break }
      if (client.budgetUebrig === 0) { e.grund = 'FoodNotify-Tagesbudget aufgebraucht'; break }
      if (inFolge >= config.ABBRUCH_NACH_FEHLERN) { e.grund = `${inFolge} Fehler in Folge`; break }

      // NUR Rezeptposten der gewählten Marken — sonst nichts aus der Schlange.
      const posten = await eine<any>(
        `UPDATE sync.warteschlange SET in_arbeit_seit = now(), versuche = versuche + 1
          WHERE posten_id = (
                SELECT posten_id FROM sync.warteschlange
                 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL AND faellig_ab <= now()
                   AND endpunkt LIKE 'fn:rezept%' AND marke_key = ANY($1::int[])
                 ORDER BY nachladen, prioritaet, posten_id
                 FOR UPDATE SKIP LOCKED LIMIT 1)
          RETURNING *`, [keys])
      if (!posten) { e.grund = 'Schlange der Rezeptposten leer'; break }
      if (!String(posten.endpunkt).startsWith('fn:rezept')) throw new Error(`fremder Posten ${posten.endpunkt}`)
      e.posten++
      const marke = keyZuMarke.get(Number(posten.marke_key))!
      const ep = fnEndpunkt(posten.endpunkt)
      const p = (posten.parameter ?? {}) as Record<string, string>
      const tag = new Date(posten.zeitraum_von).toISOString().slice(0, 10)
      const res = await client.holen(ep, marke, p)
      const aufgabe = (status: string, fehler: string | null, zeilen: number | null, http: number | null) => query(
        `INSERT INTO sync.aufgabe (lauf_id, endpunkt, zeitraum_von, zeitraum_bis, versuch, status,
                                   http_status, zeilen, dauer_ms, wartezeit_ms, fehler, marke_key, parameter)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [laufId, posten.endpunkt, tag, posten.versuche, status, http, zeilen, res.dauerMs,
         client.letzteWartezeitMs, fehler, posten.marke_key, JSON.stringify(p)])

      if (res.art === 'ok') {
        try {
          const zeilen = await fnLaden({
            ep, markeKey: Number(posten.marke_key), von: tag, bis: tag, parameter: p,
            daten: res.daten, httpStatus: res.status, bytes: res.bytes, hash: res.hash, laufId,
            nachladen: posten.nachladen === true,
          })
          await query(`UPDATE sync.warteschlange SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'ok',
                              letzter_fehler = NULL WHERE posten_id = $1`, [posten.posten_id])
          await aufgabe('ok', null, zeilen, res.status)
          e.ok++; inFolge = 0
          if (posten.endpunkt === 'fn:rezept_zutaten') e.zutatenGeladen++
        } catch (x) {
          const f = String(x).slice(0, 2000)
          await query(`UPDATE sync.warteschlange SET in_arbeit_seit = NULL, letzter_fehler = $1,
                              faellig_ab = now() + interval '1 hour' WHERE posten_id = $2`, [f, posten.posten_id])
          await aufgabe('fehler', f, null, res.status)
          e.fehler++; inFolge++
          aus(`FEHLER beim Laden ${posten.endpunkt} ${JSON.stringify(p)}: ${f.slice(0, 300)}`)
        }
        if (e.posten % 100 === 0) aus(`… ${e.posten} Posten, ${e.zutatenGeladen} Zutatenlisten, ${e.fehler} Fehler`)
        continue
      }

      if (res.art === 'gesperrt') {
        // Anmeldung, 403, 429: zurücklegen und Schluss — kein zweiter Versuch.
        await query(`UPDATE sync.warteschlange SET in_arbeit_seit = NULL, versuche = greatest(0, versuche - 1)
                      WHERE posten_id = $1`, [posten.posten_id])
        e.grund = `gesperrt (${res.sperrArt}): ${res.fehler}`
        break
      }

      const fehler = 'fehler' in res ? res.fehler : res.art
      if (res.status === 404 && ['fn:rezept', 'fn:rezept_zutaten', 'fn:rezept_meta'].includes(posten.endpunkt)) {
        await rezeptNichtGefunden(posten.posten_id, Number(posten.marke_key), p.rezeptId, fehler)
        await aufgabe('uebersprungen', fehler, null, 404)
        e.nichtGefunden++
        continue
      }
      await query(`UPDATE sync.warteschlange SET in_arbeit_seit = NULL, letzter_fehler = $1,
                          faellig_ab = now() + interval '1 hour' WHERE posten_id = $2`,
        [fehler.slice(0, 2000), posten.posten_id])
      await aufgabe('fehler', fehler, null, res.status ?? null)
      e.fehler++; inFolge++
      aus(`FEHLER ${posten.endpunkt} ${JSON.stringify(p)}: ${fehler.slice(0, 300)}`)
    }

    const offen = await eine<{ n: number }>(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE erledigt_am IS NULL AND endpunkt LIKE 'fn:rezept%' AND marke_key = ANY($1::int[])`, [keys])
    e.offen = Number(offen?.n ?? 0)
    const status = e.grund.startsWith('gesperrt') || e.grund.includes('in Folge') ? 'abgebrochen'
      : e.fehler > 0 ? 'teilweise' : 'ok'
    await query(
      `UPDATE sync.lauf SET beendet_am = now(), status = $2, aufgaben_gesamt = $3, aufgaben_ok = $4,
              aufgaben_fehler = $5, aufgaben_uebersprungen = $6,
              notiz = concat_ws(' · ', notiz, $7::text)
        WHERE lauf_id = $1`,
      [laufId, status, e.posten, e.ok, e.fehler, e.nichtGefunden,
       `${e.grund}; ${e.zutatenGeladen} Zutatenlisten, ${e.offen} Rezeptposten offen`])

    const stand = await query(
      `SELECT marke, rezepte_fn, rezepte, in_liste, nur_ueber_verweis, archiviert, mit_zutaten, ohne_zutaten,
              abzug_pct, nicht_gefunden, verweise_ohne_rezept, zustand
         FROM mart.rezept_stand WHERE marke_key = ANY($1::int[]) ORDER BY marke`, [keys])
    aus(`\nPraxislauf ${laufId}: ${e.posten} Posten, ${e.ok} ok, ${e.fehler} Fehler, ${e.nichtGefunden} nicht gefunden, `
      + `${e.zutatenGeladen} Zutatenlisten — Ende: ${e.grund}. Offen: ${e.offen}.`)
    console.table?.(stand)
    if (!console.table) aus(JSON.stringify(stand, null, 1))
    return e
  } finally {
    process.off('SIGINT', signal)
    process.off('SIGTERM', signal)
    await sperre.freigeben()
  }
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
  try {
    const datenbank = datenbankPruefen(arg('datenbank'))
    // VOR dem ersten Import von config: die Datenbank aus dem Argument, nicht aus der .env.
    process.env.DATABASE_URL = datenbank
    const max = arg('max-rezepte')
    const e = await rezeptePraxis({
      datenbank, marken: arg('marke') ? [arg('marke')!] : undefined,
      maxRezepte: max ? Number(max) : undefined,
    })
    const { pool } = await import('./db/pool')
    await pool.end()
    process.exit(e.grund.startsWith('gesperrt') || e.fehler > 0 ? 1 : 0)
  } catch (x) {
    console.error(String((x as Error)?.message ?? x))
    process.exit(3)
  }
}
