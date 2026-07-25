/**
 * Der Worker: eine Schlange, ein Tempo, kein Unterschied zwischen laufendem
 * Sync und Backfill.
 *
 * Er läuft, bis eines davon eintritt:
 *   * Die Schlange ist leer.
 *   * Das Arbeitsfenster endet.
 *   * Das Tagesbudget ist aufgebraucht.
 *   * Zu viele Fehler in Folge — dann bricht er ab, statt stur weiterzulaufen.
 *
 * Jeder Posten wird einzeln quittiert. Ein Absturz mitten im Lauf kostet
 * höchstens den einen Posten; alles andere steht in der Datenbank.
 */
import pg from 'pg'
import { query, eine, pool } from '../db/pool'
import { config } from '../config'
import { log } from '../lib/log'
import { LinaClient, strukturPruefen } from '../lina/client'
import { endpunkt } from '../lina/endpunkte'
import { laden } from './laden'
import { alsIsoDatum } from '../lib/time'

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Exponentiell mit Jitter — nie im festen Takt nachfassen. */
function wiedervorlage(versuche: number): string {
  const basisMin = Math.min(6 * 60, 5 * 2 ** (versuche - 1))
  const jitter = 0.5 + Math.random()
  return `${Math.round(basisMin * jitter)} minutes`
}

/**
 * Schlüssel der Advisory-Sperre. Frei gewählt, muss nur stabil sein.
 * (`sync.worker` als Zahl gelesen — irgendein fester Wert tut es.)
 */
const SPERRE = 8_142_026

/**
 * Genau ein Worker gleichzeitig, prozessübergreifend.
 *
 * Ohne diese Sperre ist die Drosselung wirkungslos, sobald die Schlange länger
 * ist als ein Lauf: Dokploy startet `bun run sync` stündlich, ein Backfill-Lauf
 * dauert aber bis zum Tagesbudget — also viele Stunden. Die Läufe würden sich
 * stapeln. `FOR UPDATE SKIP LOCKED` in der Warteschlange verhindert nur, dass
 * zwei denselben Posten greifen; parallel arbeiten dürften sie trotzdem, und
 * das Tagesbudget zählt jeder Prozess für sich im Speicher. Zehn Worker wären
 * zehnfaches Tempo und zehnfaches Budget.
 *
 * Vor dem 25.07.2026 hat das Arbeitsfenster diesen Fall zufällig gedeckelt.
 * Seit es entfallen ist, braucht es die Sperre explizit.
 *
 * `pg_try_advisory_lock` ist an die Verbindung gebunden, nicht an eine
 * Transaktion — die Verbindung muss also den ganzen Lauf über offen bleiben.
 * Sie fällt beim Verbindungsende von selbst weg, ein Absturz blockiert nichts.
 *
 * **Bewusst eine eigene Verbindung statt einer aus `pool`.** `pool.end()` am
 * Ende des Laufs wartet auf alle ausgecheckten Verbindungen — eine dauerhaft
 * gehaltene aus dem Pool lässt jeden Lauf am Ende hängen. Genau das ist beim
 * ersten Versuch passiert (60 s Timeout im Ende-zu-Ende-Test, 25.07.2026).
 */
async function sperreHolen(): Promise<{ frei: boolean; freigeben: () => Promise<void> }> {
  const verbindung = new pg.Client({ connectionString: config.DATABASE_URL })
  await verbindung.connect()
  try {
    const r = await verbindung.query('SELECT pg_try_advisory_lock($1) AS ok', [SPERRE])
    if (r.rows[0]?.ok !== true) {
      await verbindung.end()
      return { frei: false, freigeben: async () => {} }
    }
    // Kein explizites Unlock nötig: das Verbindungsende gibt die Sperre frei.
    return { frei: true, freigeben: () => verbindung.end() }
  } catch (e) {
    await verbindung.end().catch(() => {})
    throw e
  }
}

export type LaufErgebnis = {
  laufId: string | null
  ok: number
  keineDaten: number
  fehler: number
  uebersprungen: number
  status: 'ok' | 'teilweise' | 'fehlgeschlagen' | 'abgebrochen' | 'lauf_uebersprungen'
}

export async function workerLauf(
  ausloeser: 'zeitplan' | 'manuell' | 'backfill' = 'zeitplan',
): Promise<LaufErgebnis> {
  const sperre = await sperreHolen()
  if (!sperre.frei) {
    // Kein Fehler, sondern der Normalfall bei einem stündlichen Zeitplan und
    // einem noch laufenden Backfill. Exitcode bleibt 0.
    log.info('lauf übersprungen — es läuft bereits einer', { ausloeser })
    return { laufId: null, ok: 0, keineDaten: 0, fehler: 0, uebersprungen: 0,
             status: 'lauf_uebersprungen' }
  }
  try {
    return await workerLaufIntern(ausloeser)
  } finally {
    // `workerLaufIntern` schließt am Ende den Pool. Dann ist die Sperre über
    // das Verbindungsende ohnehin schon weg, und der explizite Unlock schlägt
    // fehl — das ist erwartet und kein Grund, den Lauf als Fehler zu melden.
    await sperre.freigeben().catch(() => {})
  }
}

async function workerLaufIntern(
  ausloeser: 'zeitplan' | 'manuell' | 'backfill',
): Promise<LaufErgebnis> {
  const client = new LinaClient()

  const frei = await eine<{ n: number }>(`SELECT sync.haengende_posten_freigeben() AS n`)
  if (frei && Number(frei.n) > 0) log.warn('hängende Posten freigegeben', { anzahl: Number(frei.n) })

  const lauf = await eine<{ lauf_id: string }>(
    `INSERT INTO sync.lauf (ausloeser) VALUES ($1) RETURNING lauf_id`, [ausloeser])
  const laufId = String(lauf!.lauf_id)
  log.info('lauf gestartet', { laufId, ausloeser })

  let ok = 0, keineDaten = 0, fehler = 0, uebersprungen = 0
  let fehlerInFolge = 0
  let status: 'ok' | 'teilweise' | 'fehlgeschlagen' | 'abgebrochen' = 'ok'
  let notiz: string | null = null

  try {
    while (true) {
      if (!client.imFenster()) { notiz = 'Arbeitsfenster beendet'; break }
      if (client.budgetUebrig === 0) { notiz = 'Tagesbudget aufgebraucht'; break }
      if (config.MAX_POSTEN_PRO_LAUF > 0 && ok + keineDaten + fehler >= config.MAX_POSTEN_PRO_LAUF) {
        notiz = 'Postenobergrenze je Lauf erreicht'; break
      }
      if (fehlerInFolge >= config.ABBRUCH_NACH_FEHLERN) {
        status = 'abgebrochen'
        notiz = `${fehlerInFolge} Fehler in Folge — Lauf gestoppt, statt weiter gegen LINA zu laufen`
        log.error('abbruch wegen fehlerhäufung', { fehlerInFolge })
        break
      }

      const posten = await eine<any>(`SELECT * FROM sync.posten_holen($1)`, [laufId])
      if (!posten?.posten_id) { notiz ??= 'Schlange leer'; break }

      const ep = endpunkt(posten.endpunkt)
      // postgres.js gibt date als Date zurueck - hier einmal normalisieren.
      const von = alsIsoDatum(posten.zeitraum_von)
      const bis = alsIsoDatum(posten.zeitraum_bis)
      const extra = (posten.parameter ?? {}) as Record<string, string>
      const parameter = ep.parameter(von, bis, extra)
      if (posten.betrieb_enc_id) parameter.storeId = posten.betrieb_enc_id

      const res = await client.holen(ep, parameter)

      // --- Erfolg -------------------------------------------------------
      if (res.art === 'ok') {
        const pruefung = strukturPruefen(ep.key, res.daten)
        if (!pruefung.ok) {
          // Nicht verwerfen: Raw behält die Daten, aber es muss auffallen.
          await query(
            `INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich)
             VALUES ($1, $2, $3)`,
            [ep.key, JSON.stringify(pruefung.erwartet), JSON.stringify(pruefung.tatsaechlich)])
          log.warn('schema weicht ab', { endpunkt: ep.key, von })
        }

        let zeilen = 0
        try {
          zeilen = await laden({
            ep, von, bis, parameter, daten: res.daten,
            httpStatus: res.status, bytes: res.bytes, hash: res.hash,
            laufId, betriebEncId: posten.betrieb_enc_id ?? null,
          })
        } catch (e) {
          fehler++; fehlerInFolge++
          await query(
            `UPDATE sync.warteschlange
                SET in_arbeit_seit = NULL, letzter_fehler = $1,
                    faellig_ab = now() + $2::interval
              WHERE posten_id = $3`,
            [String(e).slice(0, 2000), wiedervorlage(posten.versuche), posten.posten_id])
          await protokoll(laufId, ep.key, posten, 'fehler', res, client, String(e))
          log.error('laden fehlgeschlagen', { endpunkt: ep.key, von, fehler: String(e) })
          continue
        }

        ok++; fehlerInFolge = 0
        await query(
          `UPDATE sync.warteschlange
              SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'ok', letzter_fehler = NULL
            WHERE posten_id = $1`, [posten.posten_id])
        await protokoll(laufId, ep.key, posten, 'ok', res, client, null, zeilen)
        log.debug('geladen', { endpunkt: ep.key, von, zeilen, dauerMs: res.dauerMs })
        continue
      }

      // --- Kein Fehler: der Betrieb hat für diesen Bericht nichts --------
      if (res.art === 'keine_daten') {
        keineDaten++; fehlerInFolge = 0
        await query(
          `UPDATE sync.warteschlange
              SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'keine_daten'
            WHERE posten_id = $1`, [posten.posten_id])
        await protokoll(laufId, ep.key, posten, 'keine_daten', res, client)
        continue
      }

      // --- Fehler -------------------------------------------------------
      fehler++; fehlerInFolge++
      const aufgeben = !res.wiederholbar || posten.versuche >= config.MAX_VERSUCHE
      if (aufgeben) {
        uebersprungen++
        await query(
          `UPDATE sync.warteschlange
              SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'aufgegeben',
                  letzter_fehler = $1
            WHERE posten_id = $2`, [res.fehler.slice(0, 2000), posten.posten_id])
        log.error('posten aufgegeben', { endpunkt: ep.key, von, versuche: posten.versuche, fehler: res.fehler })
      } else {
        await query(
          `UPDATE sync.warteschlange
              SET in_arbeit_seit = NULL, letzter_fehler = $1,
                  faellig_ab = now() + $2::interval
            WHERE posten_id = $3`,
          [res.fehler.slice(0, 2000), wiedervorlage(posten.versuche), posten.posten_id])
        log.warn('wiedervorlage', { endpunkt: ep.key, von, versuche: posten.versuche, fehler: res.fehler })
      }
      await protokoll(laufId, ep.key, posten, aufgeben ? 'uebersprungen' : 'fehler', res, client, res.fehler)
    }

    if (fehler > 0 && status === 'ok') status = 'teilweise'
  } finally {
    await query(
      `UPDATE sync.lauf
          SET beendet_am = now(), status = $1, notiz = $2,
              aufgaben_gesamt = $3, aufgaben_ok = $4, aufgaben_fehler = $5,
              aufgaben_uebersprungen = $6
        WHERE lauf_id = $7`,
      [status, notiz, ok + keineDaten + fehler, ok, fehler, uebersprungen, laufId])
    log.info('lauf beendet', {
      laufId, status, ok, keineDaten, fehler, uebersprungen,
      budgetVerbraucht: client.budgetVerbraucht, notiz,
    })
    await pool.end()
  }

  return { laufId, ok, keineDaten, fehler, uebersprungen, status }
}

async function protokoll(
  laufId: string, endpunktKey: string, posten: any,
  status: 'ok' | 'keine_daten' | 'fehler' | 'uebersprungen',
  res: { status?: number | null; dauerMs: number }, client: LinaClient,
  fehler: string | null = null, zeilen: number | null = null,
) {
  await query(
    `INSERT INTO sync.aufgabe
       (lauf_id, endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, versuch,
        status, http_status, zeilen, dauer_ms, wartezeit_ms, fehler)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [laufId, endpunktKey, posten.betrieb_enc_id ?? null, posten.zeitraum_von,
     posten.zeitraum_bis, posten.versuche, status, res.status ?? null, zeilen,
     res.dauerMs, client.letzteWartezeitMs, fehler])
}
