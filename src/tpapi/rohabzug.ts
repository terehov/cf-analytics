/**
 * TPAPI Stufe 2, Schritt 2a: alles Lesende holen und roh sichern (Plan
 * `docs/plan-tpapi-stufe2.md` §4; Migration `0151`).
 *
 * ZWEI EINSTIEGE, ZWEI PHASEN (S7):
 *
 *   Phase A  `rohabzugTagesgeschaeft(client)` — aufgerufen von `tpapiNachlauf()`
 *            NACH Personal je Stunde, mit demselben Client. Holt `listdays`
 *            je Betrieb (die Arbeitsliste, S2), das Fenster der letzten drei
 *            Kalendertage für Journal, Bons und Personalkosten je Tag, den
 *            fälligen Artikelstamm (wöchentlich je Betrieb, S11) und seit 0153
 *            die Umsatzprognose (ein Fenster um heute). Begrenzt durch sich
 *            selbst: 1 + 3 × 3 + 1 Aufrufe je Betrieb, dazu 13 einmal die Woche.
 *   Phase C  `tpapiNachladen()` — aus src/sync.ts neben der LINA-Spur. Der
 *            Rückstand aus `mart.tpapi_rueckstand_tag` (seit 0153 dazu Personal
 *            je Stunde aus `mart.personal_rueckstand` und, zuletzt, die Monate
 *            der Prognose aus `mart.umsatzprognose_rueckstand`), neueste Tage zuerst,
 *            Tag außen, Betrieb innen, höchstens `TPAPI_NACHLADEN_JE_LAUF`
 *            Aufrufe und nie über `NACHLADEN_BIS` hinaus. Ein Rückstand von
 *            über 100.000 Aufrufen in Phase A hielte Phase B auf — dieselbe
 *            Lehre wie `0116`.
 *
 * DIE GLEITENDE GRENZE (S8). Höchstens `TPAPI_GRENZE_JE_BETRIEB` Aufrufe je
 * Betrieb in `TPAPI_GRENZE_MINUTEN`, gezählt im Client — und es gibt je Lauf
 * EINEN Client: Stufe 1, Phase A und Phase C teilen sich den Zähler. Ist ein
 * Betrieb an der Grenze, wird er übersprungen und kommt wieder dran, sobald
 * sein Fenster einen Platz frei hat; die anderen laufen weiter. Erst wenn
 * ALLE an der Grenze stehen, wird gewartet — bis zum nächsten freien Platz,
 * nicht im Block (`abarbeiten()`).
 *
 * DIE AUSGÄNGE, JE BETRIEB UND MODUL (S9):
 *
 *   429                    → `gebremst`: der Betrieb ist für den ganzen Lauf
 *                            aus, alle Module — LINA zählt je Laden (D6)
 *   403 „not licensed"     → `nicht_lizenziert`: nur dieses MODUL ist aus,
 *                            sieben Tage nicht gefragt, kein `teilweise`
 *                            (Ratskeller Saarbrücken hat nur Team Data)
 *   401/403 sonst          → `abgewiesen`: der Betrieb ist aus, kein zweiter
 *                            Versuch (Regel 7) — der Schlüssel selbst
 *   5xx, Netz, Formfehler  → `fehler`: das Modul bleibt dran, bis DREI in
 *                            Folge scheitern; dann ist es für diesen Lauf aus.
 *                            Abweichung von Stufe 1 (dort sofort aus),
 *                            Begründung bei `FEHLER_IN_FOLGE`.
 *
 * WIRFT NIE. Ein fehlender Rohsatz ist ein Tag, den die nächste Nacht holt.
 *
 * WAS SICHTBAR BLEIBT (Regel 10): `sync.tpapi_zugang` je Betrieb und Modul
 * (`mart.tpapi_zugang_modul`), drei Merker (`tpapi_revenue`,
 * `tpapi_personal_tag`, `tpapi_artikel`) für `mart.quelle_zulauf`, und
 * `mart.tpapi_rueckstand` mit der Prüfzeile „Rückstand fällt nicht".
 */
import { config } from '../config'
import { log } from '../lib/log'
import { eine, query } from '../db/pool'
import { nachladenVorbei } from '../sync/worker'
import { laufClient, TpapiClient, type TpapiAntwort } from './client'
import {
  aktiveStammendpunkte, aktiveTagesendpunkte, ENDPUNKT_LISTDAYS, PROGNOSE_FENSTER,
  prognoseEndpunkt, stundeEndpunkt,
  type TpapiEndpunkt, type TpapiModul,
} from './endpunkte'
import { alsBusinessdate, tagLaden } from './laden'
import { listdaysLaden, stammRohLaden, tagRohLaden, type RohErgebnis } from './roh_laden'
import { LIZENZ_PAUSE_TAGE, zugangFortschreiben, zugangSpiegeln, type ZugangZustand } from './zugang'

/** Module, die Stufe 2 selbst spiegelt; `personal` spiegelt Stufe 1. */
const EIGENE_MODULE: TpapiModul[] = ['revenue', 'artikel']

/**
 * So viele Fehler (5xx, Netz, Formfehler) IN FOLGE nimmt ein Modul eines
 * Betriebs, bevor es für diesen Lauf aus ist.
 *
 * WARUM NICHT EINER WIE IN STUFE 1. Dort fragt jede Nacht dieselben 14 Tage;
 * ein kaputter Tag kostet einen Tag. Hier läuft der Rückstand neueste zuerst
 * — ein EINZELNER Tag, an dem LINA dauerhaft 500 liefert, hielte sonst den
 * ganzen Rückstand dieses Betriebs Nacht für Nacht an genau dieser Stelle
 * fest (FoodNotify kennt das: zwei Bestellungen mit `NonUniqueResultException`
 * seit Wochen, `0135`). Drei in Folge unterscheidet „ein Tag ist kaputt" von
 * „der Server liegt": ein Ausfall kostet drei Aufrufe, kein Retry desselben
 * Tages (der Tag bleibt im Rückstand für die nächste Nacht).
 */
const FEHLER_IN_FOLGE = 3

/** Wie lange höchstens am Stück gewartet wird, wenn alle Betriebe an der Grenze stehen. */
const WARTEN_HOECHSTENS_MS = 30_000

type Betrieb = { betriebKey: number; encId: string; module: Set<TpapiModul> }

type Auftrag = {
  /** Reihenfolge im Plan — kleinere zuerst, solange der Betrieb frei ist. */
  nr: number
  betrieb: Betrieb
  ep: TpapiEndpunkt
  /** YYYY-MM-DD, nur bei Tagesendpunkten und Personal je Stunde. */
  tag?: string
  /** Nur Bereichsabrufe (Prognose): YYYY-MM-DD. */
  von?: string
  bis?: string
}

/**
 * Gruppen für Zählung und Merker. Personal je Stunde (seit 0153 im Nachladen)
 * zählt für sich und schreibt den Merker aus Stufe 1 (`tpapi_personal`) — er
 * gehört zur Quelle `tpapi:personalkosten_stunde`, nicht zu den Personalkosten
 * je Tag.
 */
type Gruppe = TpapiModul | 'stunde'

/** Merker je Endpunktgruppe — dieselben Namen stehen in src/sync/quellen.ts. */
export const MERKER_JE_MODUL: Record<Gruppe, string> = {
  revenue: 'tpapi_revenue',
  personal: 'tpapi_personal_tag',
  artikel: 'tpapi_artikel',
  stunde: 'tpapi_personal',
}

const gruppeVon = (ep: TpapiEndpunkt): Gruppe => (ep.art === 'stunde' ? 'stunde' : ep.modul)

type Gruppenstand = {
  abrufe: number
  neu: number
  unveraendert: number
  leer: number
  formfehler: number
  erfolg: number
  gebremst: number
  abgewiesen: number
  fehler: number
  nicht_lizenziert: number
}

const leererStand = (): Gruppenstand => ({
  abrufe: 0, neu: 0, unveraendert: 0, leer: 0, formfehler: 0, erfolg: 0,
  gebremst: 0, abgewiesen: 0, fehler: 0, nicht_lizenziert: 0,
})

type Laufstand = {
  phase: 'tagesgeschaeft' | 'nachladen'
  client: TpapiClient
  laufId: string | null
  /** betrieb_key → Grund, warum der Betrieb für diesen Lauf aus ist. */
  betriebAus: Map<number, 'gebremst' | 'abgewiesen'>
  /** `${betrieb_key}:${modul}` → Grund. */
  modulAus: Map<string, 'nicht_lizenziert' | 'fehler'>
  fehlerFolge: Map<string, number>
  gruppen: Record<Gruppe, Gruppenstand>
  /** Zeitgrenze erreicht oder Obergrenze — kein Zustand, nur fürs Log. */
  abbruch: string | null
  listdaysNichtMitternacht: number
}

async function laufende(): Promise<string | null> {
  const r = await eine<{ lauf_id: string | null }>(
    `SELECT max(lauf_id)::text AS lauf_id FROM sync.lauf WHERE status = 'laeuft'`)
  return r?.lauf_id ?? null
}

/**
 * Die Betriebe, die heute gefragt werden, mit den Modulen, die sie heute
 * bekommen: Schlüssel da, Modul nicht frisch „not licensed" (D7, sieben
 * Tage), Betrieb in diesem Lauf nicht schon gebremst (auch nicht von Stufe 1).
 */
async function betriebeHeute(client: TpapiClient, encIds: string[]): Promise<Betrieb[]> {
  const r = await query<{ betrieb_key: number; enc_id: string; module: TpapiModul[] }>(
    `SELECT betrieb_key, enc_id,
            array_agg(modul ORDER BY modul) FILTER (
              WHERE NOT (zustand = 'nicht_lizenziert'
                         AND zuletzt_gefragt_am > now() - make_interval(days => $1))) AS module
       FROM sync.tpapi_zugang
      WHERE schluessel_vorhanden
      GROUP BY betrieb_key, enc_id
      ORDER BY betrieb_key`, [LIZENZ_PAUSE_TAGE])
  /*
   * Nur, wofür die Umgebung JETZT einen Schlüssel hat. Im Lauf ist das
   * dasselbe wie `schluessel_vorhanden` (Phase A spiegelt aus derselben
   * Konfiguration) — aber ohne Schlüssel gäbe es nur Aufrufe, die der Client
   * gar nicht absendet und die als `fehler` zählten.
   */
  const mitSchluessel = new Set(encIds)
  return r
    .filter(b => mitSchluessel.has(b.enc_id) && !client.gebremst(b.enc_id))
    .map(b => ({ betriebKey: Number(b.betrieb_key), encId: b.enc_id, module: new Set(b.module ?? []) }))
}

function modulSchluessel(b: Betrieb, m: TpapiModul): string {
  return `${b.betriebKey}:${m}`
}

function istAus(s: Laufstand, b: Betrieb, m: TpapiModul): boolean {
  return s.betriebAus.has(b.betriebKey) || s.modulAus.has(modulSchluessel(b, m))
    || s.client.gebremst(b.encId)
}

/**
 * Einen Auftrag ausführen und seinen Ausgang festhalten. Gibt nie einen
 * Fehler weiter.
 */
/**
 * Personal je Stunde (Art `stunde`) mit dem Lader aus Stufe 1 — raw und
 * `core.personalkosten_stunde` in einer Transaktion, ohne `kostUser` (D3) —,
 * übersetzt in den Ausgang des Rohabzugs.
 */
async function stundeLaden(a: TpapiAntwort, b: Betrieb, tag: string, laufId: string | null): Promise<RohErgebnis> {
  const r = await tagLaden(a, b.betriebKey, b.encId, tag, laufId)
  if (r.ergebnis === 'geladen' || r.ergebnis === 'leer') {
    return { rawId: r.rawId, ergebnis: 'neu', zeilen: r.stunden }
  }
  return { rawId: r.rawId, ergebnis: r.ergebnis, zeilen: 0, meldung: r.meldung }
}

async function ausfuehren(s: Laufstand, x: Auftrag): Promise<void> {
  const { betrieb: b, ep } = x
  const g = s.gruppen[gruppeVon(ep)]
  const parameter: Record<string, string> = x.tag ? { businessdate: alsBusinessdate(x.tag) }
    : x.von && x.bis ? { from: alsBusinessdate(x.von), to: alsBusinessdate(x.bis) }
    : {}
  const a: TpapiAntwort = await s.client.holen(b.encId, ep.pfad, parameter)
  g.abrufe++

  let r: RohErgebnis | null = null
  let ladeFehler: string | null = null
  try {
    r = ep.art === 'tage' ? await listdaysLaden(ep, a, b.betriebKey, b.encId, s.laufId)
      : ep.art === 'tag' ? await tagRohLaden(ep, a, b.betriebKey, b.encId, x.tag!, s.laufId)
      : ep.art === 'stunde' ? await stundeLaden(a, b, x.tag!, s.laufId)
      : await stammRohLaden(ep, a, b.betriebKey, b.encId, parameter, s.laufId)
  } catch (e) {
    // Datenbankfehler. Die Meldung kann SQL-Text tragen, nie einen Schlüssel —
    // gesäubert wird trotzdem, und nie mit Inhalt der Antwort.
    ladeFehler = `Sichern gescheitert: ${String((e as Error)?.message ?? e)}`
  }

  const sauber = (t: string) => s.client.sauber(t)
  const fortschreiben = (zustand: ZugangZustand, fehler: string | null) =>
    zugangFortschreiben(b.betriebKey, ep.modul, a, zustand, fehler, sauber)
      .catch(e => log.warn('tpapi: Zugang nicht fortgeschrieben', { fehler: sauber(String(e)).slice(0, 200) }))

  // 1. Erfolgreich gesichert.
  if (r && (r.ergebnis === 'neu' || r.ergebnis === 'unveraendert')) {
    g.erfolg++
    if (r.ergebnis === 'neu') g.neu++
    else g.unveraendert++
    if (r.zeilen === 0) g.leer++
    if (r.tage) s.listdaysNichtMitternacht += r.tage.nichtBerlinerMitternacht
    s.fehlerFolge.delete(modulSchluessel(b, ep.modul))
    await fortschreiben('ok', null)
    return
  }

  // 2. Abweisung durch LINA — 429, 403, 401. Unabhängig davon, ob raw gelang.
  if (a.art === 'gebremst') {
    g.gebremst++
    s.betriebAus.set(b.betriebKey, 'gebremst')
    await fortschreiben('gebremst', a.meldung ?? 'HTTP 429')
    return
  }
  if (a.art === 'nicht_lizenziert') {
    g.nicht_lizenziert++
    s.modulAus.set(modulSchluessel(b, ep.modul), 'nicht_lizenziert')
    await fortschreiben('nicht_lizenziert', a.meldung ?? `HTTP ${a.status}`)
    return
  }
  if (a.art === 'abgewiesen') {
    g.abgewiesen++
    s.betriebAus.set(b.betriebKey, 'abgewiesen')
    await fortschreiben('abgewiesen', a.meldung ?? `HTTP ${a.status}`)
    return
  }

  // 3. Alles andere ist `fehler`: 5xx, Netz, Formfehler, Datenbank.
  if (r?.ergebnis === 'formfehler') g.formfehler++
  const fehler = ladeFehler
    ?? (r?.ergebnis === 'formfehler' ? `${ep.name}: unerwartete Antwortform: ${r.meldung ?? ''}`
        : `${ep.name}: ${a.meldung ?? `HTTP ${a.status}`}`)
  if (ladeFehler) {
    log.warn('tpapi: Antwort nicht gesichert', {
      enc_id: b.encId, endpunkt: ep.endpunkt, tag: x.tag ?? null, fehler: sauber(ladeFehler).slice(0, 300),
    })
  }
  const k = modulSchluessel(b, ep.modul)
  const n = (s.fehlerFolge.get(k) ?? 0) + 1
  s.fehlerFolge.set(k, n)
  if (n >= FEHLER_IN_FOLGE) {
    g.fehler++
    s.modulAus.set(k, 'fehler')
  }
  await fortschreiben('fehler', fehler)
}

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Die Aufträge abarbeiten — in der Reihenfolge von `nr`, aber an der
 * gleitenden Grenze vorbei.
 *
 * Je Betrieb eine Schlange (in `nr`-Reihenfolge). In jedem Schritt kommt von
 * allen Betrieben, die JETZT frei sind, der mit dem kleinsten `nr` dran. Ein
 * Betrieb an der Grenze wird übersprungen, nicht abgewartet; sobald sein
 * Fenster einen Platz frei hat, ist er mit seinem nächsten Auftrag wieder im
 * Rennen. Bei 41 Betrieben sind das 41 Vergleiche je Schritt, nicht einer je
 * Auftrag — der Rückstand hat bis zu 10.000.
 *
 * Erst wenn KEIN Betrieb frei ist, wird gewartet: bis zum frühesten freien
 * Platz, höchstens `WARTEN_HOECHSTENS_MS` am Stück, und vor jedem Aufruf wie
 * nach jedem Warten wird `ende()` gefragt (Zeitgrenze von Phase C).
 */
async function abarbeiten(s: Laufstand, auftraege: Auftrag[], ende: () => string | null): Promise<void> {
  const schlangen = new Map<string, Auftrag[]>()
  for (const x of [...auftraege].sort((p, q) => p.nr - q.nr)) {
    const l = schlangen.get(x.betrieb.encId) ?? []
    l.push(x)
    schlangen.set(x.betrieb.encId, l)
  }

  while (schlangen.size > 0) {
    const grund = ende()
    if (grund) { s.abbruch = grund; return }

    let bester: Auftrag | null = null
    let warten = Number.POSITIVE_INFINITY
    const jetzt = Date.now()
    for (const [enc, l] of schlangen) {
      while (l.length > 0 && istAus(s, l[0]!.betrieb, l[0]!.ep.modul)) l.shift()
      if (l.length === 0) { schlangen.delete(enc); continue }
      const w = s.client.freiIn(enc, jetzt)
      if (w === 0) {
        if (!bester || l[0]!.nr < bester.nr) bester = l[0]!
      } else if (w < warten) {
        warten = w
      }
    }
    if (bester) {
      schlangen.get(bester.betrieb.encId)!.shift()
      await ausfuehren(s, bester)
    } else if (schlangen.size > 0) {
      await schlaf(Math.min(warten, WARTEN_HOECHSTENS_MS))
    }
  }
}

async function merkerSchreiben(s: Laufstand, modul: Gruppe): Promise<void> {
  const g = s.gruppen[modul]
  // Ohne einen einzigen Aufruf dieser Gruppe in dieser Phase bleibt der
  // Merker, wie er ist: Phase C ohne Rückstand ist kein Versuch, und der
  // Artikelstamm ist nicht jede Nacht fällig (Kadenz im Register: acht Tage).
  if (g.abrufe === 0) return
  const teile = [
    g.gebremst ? `${g.gebremst} gebremst` : '',
    g.abgewiesen ? `${g.abgewiesen} abgewiesen` : '',
    g.fehler ? `${g.fehler} Modul(e) nach ${FEHLER_IN_FOLGE} Fehlern aus` : '',
    g.formfehler ? `${g.formfehler} Formfehler` : '',
    g.nicht_lizenziert ? `${g.nicht_lizenziert} nicht lizenziert` : '',
    g.erfolg === 0 ? 'kein Abruf erfolgreich' : '',
  ].filter(Boolean)
  await query(
    `INSERT INTO sync.merker (schluessel, wert)
     VALUES ($1, jsonb_build_object(
       'beendet_am', now(), 'ok', $2::boolean, 'fehler', $3::text, 'phase', $4::text,
       'abrufe', $5::int, 'neu', $6::int, 'unveraendert', $7::int, 'leer', $8::int,
       'formfehler', $9::int))
     ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`,
    [MERKER_JE_MODUL[modul], g.erfolg > 0, teile.length ? teile.join(', ') : null, s.phase,
     g.abrufe, g.neu, g.unveraendert, g.leer, g.formfehler],
  ).catch(e => log.warn('merker nicht geschrieben', {
    merker: MERKER_JE_MODUL[modul], fehler: String(e).slice(0, 200),
  }))
}

/**
 * Abschluss einer Phase: Merker, Logzeile, Ausgang.
 *
 * `teilweise`, wenn ein Betrieb gebremst oder abgewiesen wurde, ein Modul
 * nach drei Fehlern ausfiel, oder Aufrufe gemacht wurden und KEINER gelang.
 * Nicht: „not licensed" (ein Zustand, D7), die eigene Obergrenze, die
 * Zeitgrenze — das sind Bremsen, deren Rest im Rückstand steht und dort
 * sichtbar bleibt.
 */
async function abschliessen(s: Laufstand, extra: Record<string, unknown>): Promise<'ok' | 'teilweise'> {
  for (const m of ['revenue', 'personal', 'artikel', 'stunde'] as Gruppe[]) await merkerSchreiben(s, m)
  const summe = Object.values(s.gruppen).reduce((acc, g) => {
    for (const k of Object.keys(acc) as (keyof Gruppenstand)[]) acc[k] += g[k]
    return acc
  }, leererStand())
  log.info(`tpapi rohabzug ${s.phase}`, {
    abrufe: summe.abrufe, neu: summe.neu, unveraendert: summe.unveraendert, leer: summe.leer,
    formfehler: summe.formfehler, gebremst: summe.gebremst, abgewiesen: summe.abgewiesen,
    module_aus_nach_fehlern: summe.fehler, nicht_lizenziert: summe.nicht_lizenziert,
    abbruch: s.abbruch, listdays_nicht_berliner_mitternacht: s.listdaysNichtMitternacht,
    ...extra, sicht: 'mart.tpapi_rueckstand',
  })
  const schlecht = summe.gebremst + summe.abgewiesen + summe.fehler
  return schlecht > 0 || (summe.abrufe > 0 && summe.erfolg === 0) ? 'teilweise' : 'ok'
}

function neuerStand(phase: Laufstand['phase'], client: TpapiClient, laufId: string | null): Laufstand {
  return {
    phase, client, laufId, betriebAus: new Map(), modulAus: new Map(), fehlerFolge: new Map(),
    gruppen: { revenue: leererStand(), personal: leererStand(), artikel: leererStand(), stunde: leererStand() },
    abbruch: null, listdaysNichtMitternacht: 0,
  }
}

/**
 * Phase A: `listdays`, das Fenster, der fällige Artikelstamm.
 *
 * DAS FENSTER SIND KALENDERTAGE (gestern bis vor drei Tagen), nicht die
 * jüngsten drei Einträge aus `listdays` — Abweichung vom Wortlaut des Plans
 * („die letzten 3 Geschäftstage"), Begründung in §8: um 05:02 ist der
 * Geschäftstag von gestern noch nicht vorbei (er endet 07:59) und steht
 * womöglich noch nicht in `listdays`; ein geschlossener Betrieb hätte seine
 * „letzten drei" vielleicht vor Monaten und holte sie jede Nacht neu; und ein
 * Betrieb ohne `revenue` hat gar keine Liste, braucht aber das Fenster für
 * Personalkosten je Tag. Ein Ruhetag kostet einen Aufruf mit leerer Antwort.
 *
 * Reihenfolge: erst `listdays` für alle, dann je Tag (neueste zuerst) alle
 * Betriebe, je Betrieb die drei Endpunkte — Tag außen, Betrieb innen (D6) —,
 * zuletzt der Artikelstamm, Endpunkt außen, Betrieb innen.
 */
export async function rohabzugTagesgeschaeft(client: TpapiClient): Promise<'ok' | 'teilweise' | 'uebersprungen'> {
  const encIds = Object.keys(config.TPAPI_SCHLUESSEL)
  const s = neuerStand('tagesgeschaeft', client, null)
  try {
    for (const m of EIGENE_MODULE) await zugangSpiegeln(encIds, m)
    if (encIds.length === 0) return 'uebersprungen'
    s.laufId = await laufende()

    const betriebe = await betriebeHeute(client, encIds)
    const auftraege: Auftrag[] = []
    let nr = 0

    for (const b of betriebe) {
      if (b.module.has(ENDPUNKT_LISTDAYS.modul)) auftraege.push({ nr: nr++, betrieb: b, ep: ENDPUNKT_LISTDAYS })
    }

    const tagesEp = aktiveTagesendpunkte()
    const maxFenster = Math.max(0, ...tagesEp.map(e => e.fensterTage))
    const tage = maxFenster > 0
      ? await query<{ tag: string; abstand: number }>(
          `SELECT (current_date - g)::text AS tag, g AS abstand
             FROM generate_series(1, $1::int) AS g ORDER BY g`, [maxFenster])
      : []
    for (const { tag, abstand } of tage) {
      for (const b of betriebe) {
        for (const ep of tagesEp) {
          if (ep.fensterTage >= Number(abstand) && b.module.has(ep.modul)) {
            auftraege.push({ nr: nr++, betrieb: b, ep, tag })
          }
        }
      }
    }

    /*
     * Artikelstamm: je Betrieb und Liste fällig, wenn der letzte erfolgreiche
     * Abzug älter ist als TPAPI_STAMM_TAGE (oder es keinen gibt). Je Liste,
     * nicht je Betrieb: scheitert eine von dreizehn, holt die nächste Nacht
     * genau diese nach und nicht alle dreizehn.
     */
    const stammEp = aktiveStammendpunkte()
    const artikelBetriebe = betriebe.filter(b => b.module.has('artikel'))
    if (stammEp.length > 0 && artikelBetriebe.length > 0) {
      const frisch = await query<{ betrieb_key: number; endpunkt: string }>(
        `SELECT DISTINCT betrieb_key, endpunkt FROM core.tpapi_stammabzug
          WHERE endpunkt = ANY($1::text[]) AND betrieb_key = ANY($2::int[])
            AND abgerufen_am > now() - make_interval(days => $3)`,
        [stammEp.map(e => e.endpunkt), artikelBetriebe.map(b => b.betriebKey), config.TPAPI_STAMM_TAGE])
      const istFrisch = new Set(frisch.map(f => `${f.betrieb_key}:${f.endpunkt}`))
      for (const ep of stammEp) {
        for (const b of artikelBetriebe) {
          if (b.module.has(ep.modul) && !istFrisch.has(`${b.betriebKey}:${ep.endpunkt}`)) {
            auftraege.push({ nr: nr++, betrieb: b, ep })
          }
        }
      }
    }

    /*
     * Die Umsatzprognose (seit 0153): je Betrieb ein Aufruf für ein Fenster um
     * heute — ab dem Monatsersten (oder vor sieben Tagen, wenn das früher ist)
     * bis in 14 Tagen. Zuletzt, damit sie keinem Tagesendpunkt Platz an der
     * gleitenden Grenze nimmt. Ob LINA Tage in der Zukunft liefert, misst
     * mart.umsatzprognose_tag.tage_voraus_erstmals.
     */
    const prognose = prognoseEndpunkt()
    if (prognose) {
      const [f] = await query<{ von: string; bis: string }>(
        `SELECT least(current_date - $1::int, date_trunc('month', current_date)::date)::text AS von,
                (current_date + $2::int)::text AS bis`, [PROGNOSE_FENSTER.zurueck, PROGNOSE_FENSTER.voraus])
      for (const b of betriebe) {
        if (b.module.has(prognose.modul)) auftraege.push({ nr: nr++, betrieb: b, ep: prognose, von: f!.von, bis: f!.bis })
      }
    }

    await abarbeiten(s, auftraege, () => null)
    return await abschliessen(s, { betriebe: betriebe.length, auftraege: auftraege.length })
  } catch (e) {
    const fehler = client.sauber(String((e as Error)?.message ?? e)).slice(0, 300)
    log.error('tpapi-rohabzug (phase a) fehlgeschlagen — der Sync-Lauf geht weiter', { fehler })
    return 'teilweise'
  }
}

export type TpapiNachladenOptionen = {
  client?: TpapiClient
  /** Für Tests: eine eigene Zeitgrenze statt `NACHLADEN_BIS`. Gibt einen Grund zurück, wenn Schluss ist. */
  ende?: () => string | null
}

/**
 * Phase C: der Rückstand (`mart.tpapi_rueckstand_tag`), neueste Tage zuerst.
 *
 * DIE ARBEITSLISTE KOMMT AUS DER SICHT, nicht aus einer zweiten Rechnung hier:
 * was das Nachladen holt und was die Prüfzeile als Rückstand zählt, soll
 * dieselbe Zahl sein. Gefiltert wird hier nur, was die Sicht nicht weiß: die
 * aktiven Endpunkte des Registers, die Betriebe und Module, die HEUTE gefragt
 * werden (sieben Tage Pause nach „not licensed", gebremst in Phase A), und
 * die Obergrenze.
 *
 * DIE ZEITGRENZE ist dieselbe wie die der LINA-Spur (`NACHLADEN_BIS`,
 * `nachladenVorbei()` aus sync/worker.ts), gemessen ab dem Beginn dieser
 * Funktion. Beide Spuren enden damit zur selben Uhrzeit vor dem nächsten Lauf.
 */
export async function tpapiNachladen(opt: TpapiNachladenOptionen = {}): Promise<'ok' | 'teilweise' | 'uebersprungen'> {
  const encIds = Object.keys(config.TPAPI_SCHLUESSEL)
  const client = opt.client ?? laufClient() ?? new TpapiClient()
  const s = neuerStand('nachladen', client, null)
  try {
    if (encIds.length === 0) return 'uebersprungen'
    if (config.TPAPI_NACHLADEN_JE_LAUF === 0) {
      log.info('tpapi nachladen aus (TPAPI_NACHLADEN_JE_LAUF = 0)', { sicht: 'mart.tpapi_rueckstand' })
      return 'uebersprungen'
    }
    s.laufId = await laufende()
    const beginn = new Date()
    const ende = opt.ende ?? (() =>
      nachladenVorbei(new Date(), beginn, config.NACHLADEN_BIS)
        ? `Nachladen-Ende erreicht (${config.NACHLADEN_BIS} Uhr Ortszeit)` : null)

    const betriebe = await betriebeHeute(client, encIds)
    const nachKey = new Map(betriebe.map(b => [b.betriebKey, b]))
    const tagesEp = aktiveTagesendpunkte()
    const nachEndpunkt = new Map(tagesEp.map(e => [e.endpunkt, e]))
    let auftraege: Auftrag[] = []
    const stunde = config.TPAPI_STUNDE_NACHLADEN === 1 ? stundeEndpunkt() : null
    const prognose = prognoseEndpunkt()
    if (stunde) nachEndpunkt.set(stunde.endpunkt, stunde)
    if (prognose) nachEndpunkt.set(prognose.endpunkt, prognose)
    if (betriebe.length > 0 && nachEndpunkt.size > 0) {
      /*
       * Paare (Betrieb, Modul), die heute gefragt werden, als zwei
       * gleichlange Listen — so filtert die Datenbank, bevor sie sortiert
       * und schneidet, und die Obergrenze geht nicht an Betriebe, die heute
       * ohnehin nicht dran sind (dieselbe Falle wie in Stufe 1).
       *
       * DREI ARBEITSLISTEN, EINE OBERGRENZE (seit 0153):
       *   rang 0  die fehlenden Tage von Journal, Bons und Personalkosten je
       *           Tag (mart.tpapi_rueckstand_tag) und von Personal je Stunde
       *           (mart.personal_rueckstand, alles jenseits dessen, was Phase A
       *           holt) — gemeinsam neueste zuerst, Tag außen, Betrieb innen
       *   rang 1  die fehlenden Monate der Prognose (mart.umsatzprognose_rueckstand)
       *           — DANACH: Tage fallen hinten aus listdays heraus, eine
       *           Prognose nicht, und eine nachträglich geholte Prognose ist
       *           die schwächere Zahl
       */
      const paare = betriebe.flatMap(b => [...b.module].map(m => [b.betriebKey, m] as const))
      const liste = await query<{ betrieb_key: number; endpunkt: string; tag: string | null; von: string | null; bis: string | null }>(
        `WITH p(betrieb_key, modul) AS (SELECT * FROM unnest($2::int[], $3::text[])),
         arbeit AS (
           SELECT 0 AS rang, r.geschaeftstag AS sortiert, r.betrieb_key, r.endpunkt,
                  r.geschaeftstag::text AS tag, NULL::text AS von, NULL::text AS bis
             FROM mart.tpapi_rueckstand_tag r
             JOIN p ON p.betrieb_key = r.betrieb_key AND p.modul = r.modul
            WHERE r.endpunkt = ANY($4::text[])
           UNION ALL
           SELECT 0, r.geschaeftstag, r.betrieb_key, $5::text, r.geschaeftstag::text, NULL, NULL
             FROM mart.personal_rueckstand r
             JOIN p ON p.betrieb_key = r.betrieb_key AND p.modul = 'personal'
            WHERE $5::text IS NOT NULL
           UNION ALL
           SELECT 1, r.monat, r.betrieb_key, $6::text, NULL, r.von::text, r.bis::text
             FROM mart.umsatzprognose_rueckstand r
             JOIN p ON p.betrieb_key = r.betrieb_key AND p.modul = 'revenue'
            WHERE $6::text IS NOT NULL
         )
         SELECT betrieb_key, endpunkt, tag, von, bis FROM arbeit
          ORDER BY rang, sortiert DESC, betrieb_key, endpunkt
          LIMIT $1`,
        [config.TPAPI_NACHLADEN_JE_LAUF, paare.map(p => p[0]), paare.map(p => p[1]),
         tagesEp.map(e => e.endpunkt), stunde?.endpunkt ?? null, prognose?.endpunkt ?? null])
      auftraege = liste.flatMap((z, i) => {
        const b = nachKey.get(Number(z.betrieb_key))
        const ep = nachEndpunkt.get(z.endpunkt)
        return b && ep ? [{ nr: i, betrieb: b, ep, tag: z.tag ?? undefined, von: z.von ?? undefined, bis: z.bis ?? undefined }] : []
      })
    }

    await abarbeiten(s, auftraege, ende)

    let rueckstand: number | null = null
    try {
      const r = await eine<{ n: number }>(`SELECT coalesce(sum(tage_fehlend), 0)::int AS n FROM mart.tpapi_rueckstand`)
      rueckstand = r?.n ?? null
    } catch { /* Beiwerk */ }
    return await abschliessen(s, {
      betriebe: betriebe.length, auftraege: auftraege.length,
      obergrenze: config.TPAPI_NACHLADEN_JE_LAUF, rueckstand_danach: rueckstand,
    })
  } catch (e) {
    const fehler = client.sauber(String((e as Error)?.message ?? e)).slice(0, 300)
    log.error('tpapi-nachladen (phase c) fehlgeschlagen — der Sync-Lauf geht weiter', { fehler })
    return 'teilweise'
  }
}
