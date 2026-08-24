/**
 * Holt die Schulungs-, Personal- und Auditdaten aus Bounti — als Nachlauf
 * jedes Sync-Laufs, hoechstens einmal am Tag.
 *
 * WARUM HIER UND NICHT IN EINEM EIGENEN ZEITPLAN. Dieselbe Ueberlegung wie
 * bei Yext, dem Wetter und der Handpflege nebenan, und sie hat dieses
 * Projekt schon zweimal Zeit gekostet: am 02.08.2026 stand LINA acht Tage
 * still, weil das Einreihen ein zweiter Schedule Job war und ausfiel. Der
 * Sync lief fehlerfrei weiter und meldete "ok". Ein zweiter Zeitplan waere
 * ein zweiter Ausfallpunkt, den niemand beobachtet.
 *
 * DIE REGELN, WIE NEBENAN
 *
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen. Der Import
 *      aus LINA und FoodNotify ist die Arbeit; eine fehlende Schulungszahl
 *      ist eine leere Kachel, kein verlorenes Datum. Diese Funktion faengt
 *      alles und wirft nie.
 *   2. Sie laeuft NACH dem Import.
 *   3. Sie laeuft HOECHSTENS EINMAL AM TAG (BOUNTI_ABSTAND_STUNDEN, 20).
 *
 *      ~~Der Sync-Lauf ist stuendlich~~ — NACHGEMESSEN AM 24.08.2026 IST
 *      ER TAEGLICH. In sync.lauf steht seit dem 15.08. genau EIN Lauf je
 *      Tag, taeglich um 05:03 bis 05:08, und KEINE EINZIGE Zeile mit
 *      status = 'uebersprungen' — die Migration 0081 legt sie an, sobald
 *      ein Start die Laufsperre belegt findet. Bei einem stuendlichen
 *      Zeitplan waeren das rund neun Zeilen je Tag, weil ein Lauf zehn
 *      Stunden dauert. Es gibt keine.
 *
 *      DIE SPERRE BLEIBT TROTZDEM RICHTIG, nur mit anderer Begruendung:
 *      sie schuetzt nicht mehr gegen 24 Laeufe am Tag, sondern gegen den
 *      ZWEITEN Lauf eines Tages — am 14.08.2026 gab es zwei (00:14 und
 *      09:26), und von Hand ausgeloeste Laeufe sind ausdruecklich
 *      vorgesehen. Niemand schliesst binnen neun Stunden einen Kurs ab,
 *      der die Zahlen bewegt.
 *
 *      WAS DER TAEGLICHE TAKT KOSTET, und das ist neu: bricht ein Lauf ab
 *      (30 der bisher 101 Laeufe), bekommt Bounti an diesem Tag KEINE
 *      zweite Gelegenheit. Bei einem stuendlichen Zeitplan haette es die.
 *      Der Merker steht deshalb weiterhin am ENDE — ein halb geladener
 *      Bestand darf nicht 20 Stunden lang wie ein vollstaendiger aussehen.
 *
 * WAS DIESER NACHLAUF NICHT AUFFRISCHT: keine einzige materialisierte
 * Sicht. Alle Bounti-Sichten aus Migration 0096 sind gewoehnliche Views und
 * lesen live. Seine Stelle im Ablauf ist deshalb frei waehlbar — das steht
 * hier ausdruecklich, weil bei Yext und beim Wetter genau diese Frage
 * zweimal falsch beantwortet wurde und einmal zwei Betrieben eine veraltete
 * Note in die Ampel geschrieben hat. Aendert sich das, gehoert dieser
 * Nachlauf VOR den Refresh.
 *
 * DIE REIHENFOLGE INNERHALB ist dagegen nicht frei:
 *
 *   Zuordnung    zuerst, sonst faellt ein neuer Standort einen Monat lang
 *                aus jeder Betriebszahl (dieselbe Falle wie bei Yext am
 *                14.08.2026, wo sieben operative Betriebe fehlten)
 *   Stammdaten   vor den Zuweisungen: die Momentaufnahme des Monats und
 *                die Standortzuordnung tragen jede Betriebsauswertung
 *   Lernkatalog  vor den Zuweisungen — Fremdschluessel
 *   Audits       vor den Auditberichten — Fremdschluessel
 */
import { log } from '../lib/log'
import { query, eine } from '../db/pool'
import { config } from '../config'
import { bountiKonfiguriert, bountiZaehler, BountiBudget } from './client'
import {
  stammdatenLaden, lerneinheitenLaden, zuweisungenLaden,
  fortschrittLaden, auditsLaden, auditberichteLaden,
} from './laden'
import { zuordnungAbgleichen } from './zuordnen'

/** Wie oft die Standortzuordnung abgeglichen wird (Tage). */
const ZUORDNUNG_ABSTAND_TAGE = 30

async function faellig(schluessel: string, stunden: number): Promise<boolean> {
  const r = await eine<{ faellig: boolean }>(
    `SELECT coalesce((wert->>'am')::timestamptz < now() - ($2 || ' hours')::interval, true)
              AS faellig
       FROM sync.merker WHERE schluessel = $1`, [schluessel, stunden])
  // Keine Zeile = noch nie gelaufen = faellig.
  return r === null || r.faellig === true
}

async function merkerSetzen(schluessel: string): Promise<void> {
  await query(
    `INSERT INTO sync.merker (schluessel, wert)
     VALUES ($1, jsonb_build_object('am', now()))
     ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`,
    [schluessel])
}

export async function bountiNachlauf(): Promise<void> {
  try {
    if (!bountiKonfiguriert()) {
      // Kein Fehler: Bounti ist optional, und wer keinen Schluessel hat,
      // soll keinen Fehler im Log finden, der keiner ist.
      log.debug('bounti-nachlauf uebersprungen — kein BOUNTI_API_TOKEN')
      return
    }

    if (!await faellig('bounti_letzter_lauf', config.BOUNTI_ABSTAND_STUNDEN)) {
      log.debug('bounti-nachlauf noch nicht faellig')
      return
    }

    /*
     * ERST DIE ZUORDNUNG. Ein Standort ohne Eintrag in
     * manual.betrieb_fremd_id wird geladen, faellt aber aus JEDER
     * Betriebsauswertung heraus — lautlos, weil die Sichten ueber die
     * Zuordnung joinen. Monatlich und nicht taeglich, weil hier eine
     * Entscheidung faellt und eine Entscheidung, die sich taeglich neu
     * faellt, keine ist.
     *
     * Eigenes try: ein Fehler hier darf die Daten nicht mitnehmen. Die
     * Zuordnung von gestern ist besser als keine.
     */
    if (await faellig('bounti_letzte_zuordnung', ZUORDNUNG_ABSTAND_TAGE * 24)) {
      try {
        const z = await zuordnungAbgleichen({ schreiben: true })
        await merkerSetzen('bounti_letzte_zuordnung')
        log.info('bounti-zuordnung abgeglichen', {
          standorte: z.standorte, zugeordnet: z.zugeordnet,
          geschrieben: z.geschrieben, offen: z.offen,
          mehrdeutig: z.mehrdeutig.length,
          offeneNamen: z.offene_namen.slice(0, 10).map(o => `${o.id} ${o.name}`),
          sicht: 'mart.bounti_ohne_betrieb',
        })
      } catch (e) {
        log.warn('bounti-zuordnung fehlgeschlagen — die Daten laufen trotzdem',
          { fehler: String((e as Error).message ?? e).slice(0, 300) })
      }
    }

    const stamm = await stammdatenLaden()
    const katalog = await lerneinheitenLaden()
    const zuw = await zuweisungenLaden()
    const fortschritt = await fortschrittLaden()

    /*
     * DIE AUDITS IN EIGENEM `try`, und zwar aus einem gemessenen Grund.
     *
     * Am 24.08.2026 scheiterte `auditberichteLaden()` im zweiten Lauf an
     * einem Formatfehler (`after` als Kalendertag statt ISO-Zeitstempel).
     * Der Fehler riss den ganzen Nachlauf mit — und weil der Merker erst am
     * ENDE gesetzt wird, blieb er ungesetzt: der stuendliche Sync-Lauf
     * haette Bounti von da an jede Stunde erneut abgefragt, rund 400 Aufrufe
     * gegen ein Stundenlimit von 3.000.
     *
     * Die Audits sind der kleinste Teil dieser Quelle (drei Haeuser nutzen
     * das Modul). Sie duerfen die Schulungsdaten nicht mitnehmen — dieselbe
     * Ueberlegung wie bei `analyticsLaden()` in yext/nachlauf.ts.
     */
    let audits = 0
    let berichte: { zeilen: number; ab: string | null } = { zeilen: 0, ab: null }
    try {
      audits = await auditsLaden()
      berichte = await auditberichteLaden()
    } catch (e) {
      if (e instanceof BountiBudget) throw e
      log.warn('bounti-audits fehlgeschlagen — Schulungsdaten stehen bereits',
        { fehler: String((e as Error).message ?? e).slice(0, 300) })
    }

    /*
     * Der Merker steht am ENDE und nur bei einem Durchlauf ohne Abbruch.
     * Waere er weiter oben gesetzt, wartete ein abgebrochener Lauf trotzdem
     * 20 Stunden bis zum naechsten Versuch — und ein halb geladener Bestand
     * saehe aus wie ein vollstaendiger.
     */
    await merkerSetzen('bounti_letzter_lauf')

    const z = bountiZaehler()
    log.info('bounti-nachlauf fertig', {
      standorte: stamm.standorte, rollen: stamm.rollen,
      aktiv: stamm.aktiv, archiviert: stamm.archiviert,
      ohneStandort: stamm.ohne_standort,
      kurse: katalog.kurse, pfade: katalog.pfade,
      lerneinheitenGeholt: zuw.lerneinheiten, zuweisungen: zuw.zeilen,
      nochNieGeholt: zuw.offen,
      fortschritt, audits, auditberichte: berichte.zeilen,
      aufrufe: z.aufrufe, kontingentRest: z.rest,
      sicht: 'mart.bounti_zuweisung_stand',
    })

    if (zuw.fehler.length > 0) {
      log.warn('bounti teilweise', { fehler: zuw.fehler.length, erste: zuw.fehler.slice(0, 3) })
    }
    /*
     * Regel 10: ein Rueckstand, der nicht faellt, ist der Zustand, den
     * dieses Projekt zweimal uebersehen hat. Er steht deshalb nicht nur
     * als Zahl in der Zeile darueber, sondern bekommt eine eigene
     * Meldung, solange er besteht.
     */
    if (zuw.offen > 0) {
      log.warn('bounti-zuweisungen noch im Rueckstand — die Zahl MUSS fallen', {
        nochNieGeholt: zuw.offen, jeLauf: config.BOUNTI_LERNEINHEITEN_JE_LAUF,
        budgetErschoepft: zuw.budget_erschoepft,
        sicht: 'mart.bounti_zuweisung_stand',
      })
    }
  } catch (e) {
    if (e instanceof BountiBudget) {
      // Kein Fehler, sondern das Ende der Arbeit fuer heute. Der Merker
      // bleibt ungesetzt, der naechste Lauf macht weiter.
      log.warn('bounti-lauf wegen Aufrufbudget beendet — der Rest folgt beim naechsten Lauf',
        { meldung: e.message, ...bountiZaehler() })
      return
    }
    // Regel 1. Ein abgelaufener Schluessel, ein Netzhaenger, eine
    // geaenderte Antwortform — nichts davon darf den Import mitnehmen.
    log.warn('bounti-nachlauf fehlgeschlagen — der Sync-Lauf bleibt davon unberuehrt',
      { fehler: String((e as Error).message ?? e).slice(0, 300) })
  }
}
