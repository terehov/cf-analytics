/**
 * Personal je Stunde aus LINAs Third-Party-API — der fünfte Eintrag in
 * `dienste` (Phase A, src/sync.ts); mit dem Import gezählt der sechste Dienst.
 *
 * WARUM EIN EIGENER DIENST (Plan D2). Anderer Host, eigener Zugang je Betrieb
 * mit dokumentiertem Limit, keine Sitzung des Scrapers. Die Ladenakte bekam
 * keine eigene Spur, weil sie DERSELBE Zugang ist wie die Berichte — das hier
 * ist ein anderer. Er läuft deshalb neben dem Import, nicht in ihm; keine
 * materialisierte Sicht liest seine Tabellen (D8), seine Stelle in Phase A ist
 * also frei wählbar.
 *
 * ZWEI DINGE, EINE STELLE — wie beim Wetter:
 *
 *   1. ein ROLLIERENDES FENSTER (`TPAPI_FENSTER_TAGE`, 14): Schichten werden
 *      nach dem Tag noch genehmigt und korrigiert, ein geholter Tag ist nicht
 *      endgültig.
 *   2. ein BACKFILL MIT OBERGRENZE (`TPAPI_BACKFILL_JE_LAUF`, 2.000 Betrieb-
 *      Tage), neueste zuerst, kein Handbefehl. Die Arbeitsliste ist
 *      `mart.personal_rueckstand`; ein leerer Tag zählt als geholt (D5).
 *      LINA liefert rund ein Jahr zurück — der Rückstand ist eine FRIST.
 *
 * REIHENFOLGE: TAG AUSSEN, BETRIEB INNEN (D6). Damit trifft die innere
 * Schleife jeden Betrieb bei 41 Betrieben etwa alle 41 s — rund 22 Aufrufe je
 * Laden und 15 Minuten gegen dokumentierte 100, auch wenn Bounti und Sell &
 * Pick am selben Laden mitzählen. Betrieb außen hieße: 80 Aufrufe in 80
 * Sekunden gegen EINEN Laden.
 *
 * DIE AUSGÄNGE JE BETRIEB, für diesen Lauf:
 *
 *   429                    → `gebremst`, Betrieb aus für diesen Lauf
 *   403 „not licensed"     → `nicht_lizenziert`, Betrieb aus, sieben Tage
 *                            nicht gefragt (D7) — ein Zustand, kein Fehler
 *   401/403 sonst          → `abgewiesen`, Betrieb aus, kein zweiter Versuch
 *                            (Regel 7)
 *   5xx, Netz, Formfehler  → `fehler`, Betrieb aus, nächste Nacht wieder
 *   TPAPI_AUFRUFE_JE_BETRIEB erreicht → Betrieb aus, KEIN Zustand: das ist
 *                            die eigene Obergrenze, keine Aussage über LINA
 *
 * WIRFT NIE. Eine fehlende Personalzahl ist eine leere Spalte, kein
 * verlorener Umsatz.
 *
 * WAS SICHTBAR BLEIBT (Regel 10): `sync.tpapi_zugang` je Betrieb mit Zustand
 * und letztem Fehler (in `mart.tpapi_zugang` neben allen 141 Betrieben), der
 * Merker `tpapi_personal` für `mart.quelle_zulauf` (gefragt ist nicht
 * geliefert, seit 0130), und `mart.personal_rueckstand` — die Zahl, die von
 * Nacht zu Nacht FALLEN muss. Ein abgebrochener Backfill sieht sonst genauso
 * aus wie ein fertiger.
 *
 * SEIT 0151 HÄNGT DER ROHABZUG DAHINTER (Stufe 2, `rohabzug.ts`): nach
 * Personal je Stunde holt derselbe Dienst mit demselben Client `listdays`,
 * das Dreitagesfenster von Journal, Bons und Personalkosten je Tag und den
 * fälligen Artikelstamm. Begründung der Reihenfolge an `tpapiNachlauf()`.
 * Dazu teilt sich Stufe 1 seitdem die gleitende Grenze je Betrieb
 * (`client.freiIn()`), sonst ändert sich hier nichts.
 */
import { config } from '../config'
import { log } from '../lib/log'
import { eine, query } from '../db/pool'
import { laufClientMerken, PFAD_PERSONAL_STUNDE, TpapiClient, type TpapiAntwort } from './client'
import { alsBusinessdate, tagLaden } from './laden'
import { LIZENZ_PAUSE_TAGE, zugangSpiegeln } from './zugang'
import { rohabzugTagesgeschaeft } from './rohabzug'
import { tpapiCoreTagesgeschaeft } from './core_laden'

const MODUL = 'personal'
const MERKER = 'tpapi_personal'

type Betrieb = { betriebKey: number; encId: string }

/** Warum ein Betrieb in diesem Lauf nicht mehr gefragt wird. */
type Aus = 'gebremst' | 'nicht_lizenziert' | 'abgewiesen' | 'fehler' | 'grenze'

export type TpapiZaehler = {
  betriebe: number
  abrufe: number
  geladen: number
  leer: number
  fenster: number
  backfill: number
  ohneBetrieb: number
  aus: Record<Aus, number>
}

export type TpapiNachlaufOptionen = {
  client?: TpapiClient
  /**
   * `false` = nur Personal je Stunde (Stufe 1), ohne den Rohabzug aus 0151.
   * Für die Tests von Stufe 1, die Aufrufe und Merker auf den Aufruf genau
   * zählen; im Lauf immer `true`.
   */
  stufe2?: boolean
}

/** Die Betriebe, die heute gefragt werden: Schlüssel da, nicht frisch „not licensed". */
async function betriebeHeute(): Promise<Betrieb[]> {
  const r = await query<{ betrieb_key: number; enc_id: string }>(
    `SELECT betrieb_key, enc_id FROM sync.tpapi_zugang
      WHERE modul = $1 AND schluessel_vorhanden
        AND NOT (zustand = 'nicht_lizenziert'
                 AND zuletzt_gefragt_am > now() - make_interval(days => $2))
      ORDER BY betrieb_key`, [MODUL, LIZENZ_PAUSE_TAGE])
  return r.map(b => ({ betriebKey: Number(b.betrieb_key), encId: b.enc_id }))
}

/** Der Ausgang eines Aufrufs nach `sync.tpapi_zugang`. Fehlertext gekürzt und gesäubert. */
async function zugangFortschreiben(
  b: Betrieb, a: TpapiAntwort, zustand: Exclude<Aus, 'grenze'> | 'ok', fehler: string | null,
  saeubern: (t: string) => string,
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
    [b.betriebKey, MODUL, zustand, a.status === 0 ? null : a.status,
     fehler === null ? null : saeubern(fehler).slice(0, 200)])
}

async function laufende(): Promise<string | null> {
  const r = await eine<{ lauf_id: string | null }>(
    `SELECT max(lauf_id)::text AS lauf_id FROM sync.lauf WHERE status = 'laeuft'`)
  return r?.lauf_id ?? null
}

async function merkerSchreiben(w: {
  ok: boolean; fehler: string | null; z: TpapiZaehler
}): Promise<void> {
  await query(
    `INSERT INTO sync.merker (schluessel, wert)
     VALUES ($1, jsonb_build_object(
       'beendet_am', now(), 'ok', $2::boolean, 'fehler', $3::text,
       'betriebe', $4::int, 'abrufe', $5::int, 'geladen', $6::int, 'leer', $7::int,
       'ohne_betrieb', $8::int))
     ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`,
    [MERKER, w.ok, w.fehler, w.z.betriebe, w.z.abrufe, w.z.geladen, w.z.leer, w.z.ohneBetrieb],
  ).catch(e => log.warn('merker tpapi_personal nicht geschrieben', { fehler: String(e).slice(0, 200) }))
}

/**
 * Der TPAPI-Dienst in Phase A: erst Personal je Stunde (Stufe 1), dann der
 * Rohabzug (Stufe 2, `rohabzug.ts`) — NACHEINANDER, mit DEMSELBEN Client.
 *
 * WARUM NICHT ALS ZWEITER EINTRAG IN `dienste` (src/sync.ts). Beide Wege
 * fragen dieselben Läden. Zwei parallele Dienste hätten zwei Clients mit je
 * eigenem Takt und eigener gleitender Grenze — doppeltes Tempo gegen jeden
 * Laden, und keiner wüsste vom 429 des anderen (Plan Stufe 2 S8). Stufe 1
 * zuerst, weil ihre feste Grenze je Lauf (`TPAPI_AUFRUFE_JE_BETRIEB`) an
 * `client.aufrufe()` hängt: liefe Stufe 2 vorher, zählten deren Aufrufe dort
 * mit und nähmen Stufe 1 den Backfill weg.
 *
 * Den Client merkt sich `laufClientMerken()` für Phase C (`tpapiNachladen()`),
 * damit die gleitende Grenze und die 429-Liste über den ganzen Lauf gelten.
 *
 * SEIT 0153 DANACH DER LADER raw → core (`core_laden.ts`, Schritt 2b) für die
 * Fenstertage, den Artikelstamm und die Prognose: was diese Nacht geholt
 * wurde, steht damit vor Phase B in `core.kassenjournal` & Co. Kein Aufruf
 * gegen LINA — nur die Datenbank. Ein Ladefehler macht den Dienst
 * `teilweise`; der Rohsatz bleibt und steht in `mart.tpapi_core_stand`.
 */
export async function tpapiNachlauf(opt: TpapiNachlaufOptionen = {}): Promise<'ok' | 'teilweise' | 'uebersprungen'> {
  const client = opt.client ?? new TpapiClient()
  laufClientMerken(client)
  const stufe1 = await personalJeStunde(client)
  if (opt.stufe2 === false) return stufe1
  // Auch ohne Schlüssel: der Rohabzug spiegelt dann seine Module auf
  // `ohne_schluessel` und gibt `uebersprungen` zurück, ohne zu fragen.
  const stufe2 = await rohabzugTagesgeschaeft(client)
  const kern = await tpapiCoreTagesgeschaeft()
  if (stufe1 === 'uebersprungen') return 'uebersprungen'
  return stufe1 === 'ok' && stufe2 !== 'teilweise' && kern === 'ok' ? 'ok' : 'teilweise'
}

async function personalJeStunde(client: TpapiClient): Promise<'ok' | 'teilweise' | 'uebersprungen'> {
  const encIds = Object.keys(config.TPAPI_SCHLUESSEL)
  const z: TpapiZaehler = {
    betriebe: 0, abrufe: 0, geladen: 0, leer: 0, fenster: 0, backfill: 0, ohneBetrieb: 0,
    aus: { gebremst: 0, nicht_lizenziert: 0, abgewiesen: 0, fehler: 0, grenze: 0 },
  }

  try {
    if (encIds.length === 0) {
      /*
       * Kein Fehler: ohne Schlüssel ist die Quelle nicht eingerichtet, und
       * `sync.quelle` führt sie dann als nicht erwartet. Gespiegelt wird
       * trotzdem — wer ALLE Schlüssel aus Dokploy nimmt, soll in
       * `mart.tpapi_zugang` lauter `ohne_schluessel` sehen und nicht
       * 41 Betriebe, die scheinbar noch Zugang haben.
       */
      await zugangSpiegeln([])
      log.info('tpapi nicht eingerichtet')
      return 'uebersprungen'
    }

    const { ohneBetrieb } = await zugangSpiegeln(encIds)
    z.ohneBetrieb = ohneBetrieb.length
    if (ohneBetrieb.length > 0) {
      // Die encId ist kein Geheimnis — der Schlüssel dazu schon, und der
      // steht hier nicht.
      log.warn('tpapi: Schluessel ohne Betrieb in core.betrieb — nicht gefragt', {
        enc_ids: ohneBetrieb, sicht: 'mart.tpapi_zugang',
      })
    }

    const betriebe = await betriebeHeute()
    z.betriebe = betriebe.length
    const laufId = await laufende()
    const aus = new Map<number, Aus>()
    const erfolg = new Set<number>()

    /** Ein Betrieb, ein Tag. Gibt nie einen Fehler weiter. */
    const einTag = async (b: Betrieb, tag: string): Promise<boolean> => {
      if (aus.has(b.betriebKey)) return false
      /*
       * Zwei eigene Bremsen, beide ohne Zustand: die feste je Lauf (D6) und
       * seit 0151 die gleitende je Betrieb (Stufe 2 S8), die sich Stufe 1 mit
       * dem Rohabzug teilt. Stufe 1 wartet nicht auf einen freien Platz — sie
       * nimmt den Betrieb für diesen Lauf heraus, wie bei der festen Grenze;
       * der Rest steht im Rückstand.
       */
      if (client.aufrufe(b.encId) >= config.TPAPI_AUFRUFE_JE_BETRIEB || client.freiIn(b.encId) > 0) {
        aus.set(b.betriebKey, 'grenze')
        return false
      }
      const a = await client.holen(b.encId, PFAD_PERSONAL_STUNDE, { businessdate: alsBusinessdate(tag) })
      z.abrufe++
      try {
        const r = await tagLaden(a, b.betriebKey, b.encId, tag, laufId)
        if (r.ergebnis === 'geladen' || r.ergebnis === 'leer') {
          if (r.ergebnis === 'geladen') z.geladen++
          else z.leer++
          erfolg.add(b.betriebKey)
          await zugangFortschreiben(b, a, 'ok', null, t => client.sauber(t))
          return true
        }
        const zustand: Exclude<Aus, 'grenze'> =
          r.ergebnis === 'formfehler' ? 'fehler'
          : a.art === 'ok' ? 'fehler' : a.art
        const fehler = r.ergebnis === 'formfehler'
          ? `unerwartete Antwortform: ${r.meldung ?? ''}` : (a.meldung ?? `HTTP ${a.status}`)
        aus.set(b.betriebKey, zustand)
        await zugangFortschreiben(b, a, zustand, fehler, t => client.sauber(t))
      } catch (e) {
        // Ein Datenbankfehler beim Laden: der Betrieb ist für heute raus,
        // der Rest läuft weiter. Die Meldung kann SQL-Text tragen, aber
        // keinen Schlüssel — gesäubert wird sie trotzdem.
        aus.set(b.betriebKey, 'fehler')
        const fehler = `Laden gescheitert: ${String((e as Error)?.message ?? e)}`
        log.warn('tpapi: Tag nicht geladen', {
          enc_id: b.encId, tag, fehler: client.sauber(fehler).slice(0, 300),
        })
        await zugangFortschreiben(b, a, 'fehler', fehler, t => client.sauber(t)).catch(() => {})
      }
      return false
    }

    // 3. Das Fenster: gestern bis vor TPAPI_FENSTER_TAGE Tagen, neueste zuerst.
    const fenster = await query<{ tag: string }>(
      `SELECT (current_date - g)::text AS tag FROM generate_series(1, $1::int) AS g ORDER BY g`,
      [config.TPAPI_FENSTER_TAGE])
    for (const { tag } of fenster) {
      for (const b of betriebe) if (await einTag(b, tag)) z.fenster++
    }

    /*
     * 4. Der Backfill. Nur Betriebe, die HEUTE gefragt werden — ein
     *    Betrieb mit „not licensed" führt seine 365 Tage weiter als
     *    Rückstand (die Sicht weiß nichts von der Sieben-Tage-Pause), und
     *    ohne diesen Filter belegten sie jede Nacht die ersten Plätze der
     *    Obergrenze, ohne dass ein einziger Aufruf hinausginge.
     *
     *    Die Sortierung ist Tag absteigend, dann Betrieb: genau „Tag außen,
     *    Betrieb innen", ohne zweite Schleife.
     */
    const aktiv = betriebe.filter(b => !aus.has(b.betriebKey))
    if (config.TPAPI_BACKFILL_JE_LAUF > 0 && aktiv.length > 0) {
      const nachEnc = new Map(aktiv.map(b => [b.betriebKey, b]))
      const liste = await query<{ betrieb_key: number; geschaeftstag: string }>(
        `SELECT betrieb_key, geschaeftstag::text AS geschaeftstag
           FROM mart.personal_rueckstand
          WHERE betrieb_key = ANY($2::int[])
            AND geschaeftstag >= current_date - $3::int
          ORDER BY geschaeftstag DESC, betrieb_key
          LIMIT $1`,
        [config.TPAPI_BACKFILL_JE_LAUF, aktiv.map(b => b.betriebKey), config.TPAPI_HISTORIE_TAGE])
      for (const zeile of liste) {
        const b = nachEnc.get(Number(zeile.betrieb_key))
        if (b && await einTag(b, zeile.geschaeftstag)) z.backfill++
      }
    }

    // 6. Merker und Ausgang.
    for (const grund of aus.values()) z.aus[grund]++
    const nichtOk = z.aus.gebremst + z.aus.abgewiesen + z.aus.fehler
    const ok = erfolg.size > 0
    const teile = [
      z.aus.gebremst ? `${z.aus.gebremst} gebremst` : '',
      z.aus.abgewiesen ? `${z.aus.abgewiesen} abgewiesen` : '',
      z.aus.fehler ? `${z.aus.fehler} fehler` : '',
      z.aus.nicht_lizenziert ? `${z.aus.nicht_lizenziert} nicht lizenziert` : '',
      z.ohneBetrieb ? `${z.ohneBetrieb} Schluessel ohne Betrieb` : '',
      betriebe.length === 0 ? 'kein Betrieb gefragt' : '',
    ].filter(Boolean)
    await merkerSchreiben({ ok, fehler: teile.length ? teile.join(', ') : null, z })

    let rueckstand: number | null = null
    try {
      const r = await eine<{ n: number }>(`SELECT count(*)::int AS n FROM mart.personal_rueckstand`)
      rueckstand = r?.n ?? null
    } catch { /* die Zahl ist Beiwerk, der Lauf ist getan */ }

    log.info('tpapi personal geholt', {
      betriebe: z.betriebe, abrufe: z.abrufe, geladen: z.geladen, leer: z.leer,
      fenster: z.fenster, backfill: z.backfill,
      gebremst: z.aus.gebremst, nicht_lizenziert: z.aus.nicht_lizenziert,
      abgewiesen: z.aus.abgewiesen, fehler: z.aus.fehler, obergrenze: z.aus.grenze,
      ohne_betrieb: z.ohneBetrieb, rueckstand_tage: rueckstand,
      sicht: 'mart.tpapi_zugang',
    })

    /*
     * 7. `teilweise`, wenn ein Betrieb in diesem Lauf gebremst, abgewiesen
     *    oder mit Fehler endete, wenn ein Schlüssel keinen Betrieb trifft,
     *    oder wenn gar keiner erfolgreich war.
     *
     *    „not licensed" macht den Lauf NICHT teilweise: das ist ein Zustand
     *    des Betriebs (D7), sichtbar in `mart.tpapi_zugang` und in der
     *    Prüfzeile. Ein Lauf, der wegen eines Betriebs ohne Buchung jede
     *    Nacht `teilweise` meldet, wird nicht mehr gelesen. Die Obergrenze
     *    je Betrieb auch nicht: sie ist die eigene Bremse, der Rest steht
     *    im Rückstand.
     */
    return nichtOk > 0 || z.ohneBetrieb > 0 || !ok ? 'teilweise' : 'ok'
  } catch (e) {
    const fehler = client.sauber(String((e as Error)?.message ?? e)).slice(0, 300)
    log.error('tpapi-nachlauf fehlgeschlagen — der Sync-Lauf geht weiter', { fehler })
    await merkerSchreiben({ ok: false, fehler, z })
    return 'teilweise'
  }
}
