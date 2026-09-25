/**
 * Die Warteschlange selbst nachfüllen — der Vorlauf jedes Sync-Laufs.
 *
 * WARUM DAS HIER STEHT UND NICHT IN EINEM ZWEITEN ZEITPLAN.
 *
 * Bis zum 02.08.2026 waren Einreihen und Abarbeiten zwei getrennte
 * Befehle: `einreihen --taeglich` füllte, `sync` leerte. Beide brauchten
 * je einen Schedule Job. Fiel der erste aus, lief der zweite munter
 * weiter, meldete „ok" und tat nichts — gemessen am 02.08.2026 stand
 * LINA acht Tage still, während der Importer fehlerfrei durchlief. Ein
 * Importer, der nichts zu tun hat, sieht genauso aus wie einer, der
 * fertig ist.
 *
 * Deshalb füllt der Lauf sich jetzt selbst. Ein einziger Zeitplan
 * (`bun run sync`), ein einziger Ausfallpunkt.
 *
 * UND SEIT DEM 14.08.2026 AUCH DIE BACKFILLS. Bis dahin stand hier, der
 * Historien-Backfill bleibe bewusst Handarbeit: er stelle Zehntausende
 * Posten ein, und das solle eine Entscheidung sein. Das Argument war
 * richtig und die Folgerung falsch — dieselbe Falle wie überall sonst
 * hier. Eine Entscheidung, die jemand jedes Mal neu treffen muss, wird
 * irgendwann nicht mehr getroffen, und ihr Ausfall sieht aus wie Ruhe.
 *
 * Jetzt gilt stattdessen eine OBERGRENZE JE NACHT (`HISTORIE_JE_LAUF`,
 * 2.000 von 10.500 Aufrufen). Das ist dieselbe Bauart wie beim
 * Bestelldetail-Nachholauf (`0072`): kein Befehl, sondern eine Zahl, die
 * sich von selbst abarbeitet und dabei nie in die Nähe des Budgets kommt.
 * Auf 0 gesetzt hört es auf — das ist die Notbremse, kein Handbefehl.
 *
 * Die Schalter in `src/einreihen.ts` bleiben stehen: als Entscheidung über
 * einen bestimmten Zeitraum sind sie weiter brauchbar. Gebraucht werden
 * sie nicht mehr.
 */

import { query, eine } from '../db/pool'
import { config, fnZugaenge } from '../config'
import { log } from '../lib/log'
import { AKTIVE_ENDPUNKTE, istMomentaufnahme, einreihPrioritaet, PRIORITAET } from '../lina/endpunkte'
import { geschaeftstag } from '../lib/time'
import { istLadenakte } from '../ladenakte/endpunkte'
import { AKTIVE_BETRIEBSBERICHTE, BETRIEBSBERICHTE } from '../lina/betriebsberichte'
import { endpunkteZusichern } from './waechter'
import { quellenSpiegeln } from './quellen'

export type NachfuellStand = {
  lina: number; foodnotify: number; ladenakte: number
  /** Aufgegebene Posten, die dieser Lauf zurueckgeholt hat. */
  wiederbelebt: number; nulltage: number; nachlese: number; lochtage: number
  /** Betriebsbericht-Posten (Erstabruf, Nachlauf, Gegenprobe) — seit 0113. */
  betriebsberichte: number
}

/**
 * LINA: die letzten NACHZUEGLER_TAGE Geschäftstage, die Jahresberichte
 * des laufenden Jahres und die monatlichen Momentaufnahmen.
 */
export async function linaNachfuellen(): Promise<number> {
  const gestern = geschaeftstag(new Date(Date.now() - 24 * 3600 * 1000))

  /**
   * Ein gleitendes Fenster statt eines einzelnen Tages.
   *
   * LINAs Konzernberichte füllen sich über mehrere Tage — am 26.07.2026
   * gemessen: die letzten vier Tage komplett leer, der fünfte zu einem
   * Sechstel, erst ab dem siebten plausibel vollständig. Wer nur
   * „gestern" holt, schreibt Nullen fest, und weil der Posten danach
   * erledigt ist, bleiben sie für immer stehen. Zahlen dieser Sorte sind
   * schlimmer als fehlende: eine Lücke sieht man, eine Null nicht.
   *
   * `ON CONFLICT DO NOTHING` ist hier GENAU RICHTIG — und zwar aus
   * demselben Grund, aus dem es in `sync.historie_einreihen()` genau
   * falsch war. Der Eindeutigkeitsindex ist partiell (`WHERE erledigt_am
   * IS NULL`), er blockiert also nur noch OFFENE Posten. Derselbe Tag
   * wird nicht doppelt eingereiht, solange er aussteht, aber sehr wohl
   * erneut, wenn er fertig ist. Genau das soll er: die Zieltabellen sind
   * Upserts, der zweite Abruf korrigiert den ersten.
   */
  /**
   * DAS FENSTER GILT JE ENDPUNKT, nicht global (13.08.2026, Punkt 2.3).
   *
   * An `raw.api_antwort.payload_hash` gemessen ändern sich die drei
   * geprüften Tagesberichte völlig verschieden: der Umsatzbericht setzt
   * sich nach zwei Tagen, Personalkosten und Artikelverkauf ändern sich
   * an JEDEM der ersten zehn Tage rund zwanzig- bzw. dreißigmal. Ein
   * gemeinsames Fenster kann für höchstens einen davon richtig sein.
   *
   * Die Tage werden je Endpunkt gerechnet, weil `nachzuegler_tage`
   * verschieden ist — die frühere gemeinsame Liste hätte sonst für alle
   * den größten Wert genommen.
   */
  const tageBis = (n: number): string[] => {
    const t: string[] = []
    for (let i = 1; i <= n; i++) t.push(geschaeftstag(new Date(Date.now() - i * 24 * 3600 * 1000)))
    return t
  }

  let n = 0
  for (const ep of AKTIVE_ENDPUNKTE) {
    if (ep.schrittweite !== 'tag') continue
    for (const tag of tageBis(ep.nachzuegler_tage ?? config.NACHZUEGLER_TAGE)) {
      const r = await query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
         VALUES ($1, $2, $2, $3) ON CONFLICT DO NOTHING RETURNING posten_id`,
        [ep.key, tag, einreihPrioritaet(ep.key)])
      n += r.length
    }
  }

  /**
   * Kennzahlen laufen jahresweise und werden erneut geholt, weil die BWA
   * rückwirkend nachgebucht wird. Append-only fängt das ab.
   *
   * DAS LAUFENDE JAHR UND DAS VORJAHR (13.08.2026, Punkt 2.1). Bis dahin
   * war es nur das Jahr von „gestern", und das hatte zwei Folgen:
   *
   *   - Nachbuchungen ins VORJAHR kamen nie an. Gemessen: 2025 wurde
   *     zuletzt am 27.07.2026 geholt, 2018–2024 zwischen dem 27.07. und
   *     dem 01.08. Dezember-2025-Korrekturen aus Februar/März 2026 stehen
   *     bis heute nicht in `core.kennzahlen_monat`.
   *   - Und wir konnten es nicht einmal merken. Die viel zitierte
   *     „Rückbuchungstiefe von sieben Monaten" ist genau der Abstand von
   *     August zu Januar — also die Breite des Fensters, nicht LINAs
   *     Verhalten. Im Januar hätte dieselbe Messung „null Monate" ergeben.
   *
   * Zwei Jahre kosten zwei zusätzliche Aufrufe je Lauf (zwei Endpunkte mal
   * ein Jahr mehr), gegen ein Tagesbudget von 10.500 bei rund 82
   * verbrauchten. Das Vorjahr LÄUFT DAS GANZE JAHR MIT und nicht nur bis
   * August: erst dadurch wird die Rückbuchungstiefe überhaupt beobachtbar
   * (`mart.bwa_rueckbuchung`), und ein Fenster, das im September wortlos
   * schmaler wird, ist wieder eines, dessen Grenze niemand sieht.
   *
   * `ON CONFLICT DO NOTHING` ist hier richtig: der Eindeutigkeitsindex ist
   * partiell (`WHERE erledigt_am IS NULL`), ein ERLEDIGTER Jahresposten
   * blockiert also nichts. Genau deshalb braucht dieser Punkt auch keinen
   * Nachholauf an `sync.historie_einreihen()` vorbei (Punkt 2.2): der
   * nächste Lauf holt das Vorjahr von selbst.
   */
  const jahr = Number(gestern.slice(0, 4))
  for (const ep of AKTIVE_ENDPUNKTE.filter(e => e.schrittweite === 'jahr')) {
    for (const j of [jahr, jahr - 1]) {
      const r = await query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING posten_id`,
        [ep.key, `${j}-01-01`, `${j}-12-31`, einreihPrioritaet(ep.key)])
      n += r.length
    }
  }

  /**
   * Stammdaten-Momentaufnahmen: eine je Kalendermonat, auf den
   * Monatsersten gesetzt.
   *
   * `ON CONFLICT DO NOTHING` allein reicht dafür NICHT, auch wenn es so
   * aussieht: Der Eindeutigkeitsindex ist partiell (`WHERE erledigt_am
   * IS NULL`). Ein ERLEDIGTER Posten blockiert also nichts — der Lauf
   * hätte beim nächsten Start munter denselben Monatsersten neu
   * eingereiht, und die „monatliche" Momentaufnahme wäre in Wahrheit
   * bei jedem Lauf gelaufen.
   *
   * Das wiegt jetzt schwerer als früher: Nachfüllen passiert bei JEDEM
   * Sync-Lauf, nicht mehr einmal täglich. Deshalb ausdrücklich gegen
   * ALLE Posten desselben Zeitraums geprüft, erledigte eingeschlossen.
   */
  const monatsErster = `${gestern.slice(0, 7)}-01`
  for (const ep of AKTIVE_ENDPUNKTE.filter(istMomentaufnahme)) {
    /**
     * Der Zeitraum IST der Takt. Bei Monatstakt der Monatserste, bei
     * Wochentakt der Montag derselben Woche — beides ein Datum, das sich
     * innerhalb der Periode nicht ändert, und damit sperrt das NOT EXISTS
     * genau eine Erhebung je Periode.
     *
     * `date_trunc('week', …)` liefert in Postgres den Montag (ISO), und zwar
     * unabhängig von der Spracheinstellung. Gerechnet wird in SQL und nicht
     * in JavaScript: `geschaeftstag()` liefert bereits das fachlich richtige
     * Datum, und eine zweite Wochenlogik daneben wäre eine zweite Stelle,
     * an der dieselbe Sache falsch stehen kann.
     */
    const periodenBeginn = ep.takt === 'woche'
      ? `date_trunc('week', $2::date)::date`
      : `$2::date`
    const r = await query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       SELECT $1, ${periodenBeginn}, ${periodenBeginn}, $3
        WHERE NOT EXISTS (
              SELECT 1 FROM sync.warteschlange
               WHERE endpunkt = $1 AND zeitraum_von = ${periodenBeginn})
       RETURNING posten_id`,
      [ep.key, ep.takt === 'woche' ? gestern : monatsErster, einreihPrioritaet(ep.key)])
    n += r.length
  }

  n += await historieNachziehen()

  return n
}

/**
 * Die Historie nachziehen — der letzte Backfill, der ein Handbefehl war.
 *
 * WAS HIER ERSETZT WIRD. `bun run einreihen --historie --von … --bis …` stellte
 * die Vergangenheit in einem Schwung ein. Der Befehl bleibt (er ist als
 * Entscheidung über einen Zeitraum weiterhin brauchbar), aber niemand muss ihn
 * mehr aufrufen: **eine Reparatur, die ein Mensch anstoßen muss, ist keine
 * Reparatur, sondern eine Verabredung.** Sie fällt irgendwann aus, und ihr
 * Ausfall sieht aus wie Ruhe.
 *
 * DASS ER BISHER NICHTS ZU TUN HATTE, WAR GLÜCK UND KEIN ARGUMENT. Am
 * 14.08.2026 in Produktion nachgemessen: für die acht alten Tagesendpunkte
 * fehlt seit dem 01.01.2018 **kein einziger** Geschäftstag. Mit den acht neuen
 * Hauptsparten (`0077`) fehlen dagegen rund 3.100 Tage je Endpunkt — die es
 * ohne diese Funktion erst ab heute gäbe, und niemand hätte es der
 * Spartenauswertung angesehen.
 *
 * NEUESTE ZUERST (`ORDER BY tag DESC`). Ein Backfill, der vorne anfängt,
 * liefert das Nützlichste zuletzt; bricht er ab, fehlt genau das. Rückwärts
 * steht nach der ersten Nacht der letzte Monat.
 *
 * DIE OBERGRENZE GILT ÜBER ALLE ENDPUNKTE ZUSAMMEN, nicht je Endpunkt — sonst
 * wäre die Zahl im Budget eine andere als die in der Einstellung, sobald
 * jemand einen Endpunkt hinzufügt.
 *
 * Nur `schrittweite: 'tag'`: Jahresberichte reiht `linaNachfuellen()` ohnehin
 * für das laufende und das Vorjahr ein, und Momentaufnahmen haben keine
 * Vergangenheit (siehe `istMomentaufnahme`).
 */
export async function historieNachziehen(): Promise<number> {
  if (config.HISTORIE_JE_LAUF === 0) return 0

  let uebrig = config.HISTORIE_JE_LAUF
  let n = 0

  for (const ep of AKTIVE_ENDPUNKTE) {
    if (uebrig <= 0) break
    if (ep.schrittweite !== 'tag' || istLadenakte(ep.key)) continue

    const r = await query<{ posten_id: string }>(
      `WITH fehlend AS (
           SELECT t::date AS tag
             FROM generate_series($2::date, current_date - 1, interval '1 day') t
            WHERE NOT EXISTS (
                  SELECT 1 FROM sync.warteschlange w
                   WHERE w.endpunkt = $1 AND w.zeitraum_von = t::date)
            ORDER BY t DESC
            LIMIT $3)
       -- nachladen = true (0116): die Historie laeuft in Phase C, NACH den
       -- Auswertungen. Die Tage, die das Tagesgeschaeft braucht, hat
       -- linaNachfuellen() davor schon eingereiht — hier landet nur, was
       -- darueber hinaus fehlt.
       INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, nachladen)
       SELECT $1, tag, tag, $4, true FROM fehlend
       RETURNING posten_id`,
      [ep.key, config.HISTORIE_AB, uebrig, PRIORITAET.historie])

    if (r.length > 0) {
      log.info('historie nachgezogen', {
        endpunkt: ep.key, posten: r.length, ab: config.HISTORIE_AB,
      })
    }
    uebrig -= r.length
    n += r.length
  }

  return n
}


/**
 * Betriebsberichte einreihen — je Betrieb und Zeitraum, neueste zuerst
 * (Plan „Vollabzug", Abschnitt 5; Migration 0113).
 *
 * DER ERSTE PRODUCER FUER `betrieb_enc_id`. Die Spalte steht seit 0005 da, der
 * Worker liest sie, und bis zum 22.09.2026 setzte sie kein einziger INSERT
 * (Waechter-Befund 13.08.2026). Hier wird sie gesetzt — sonst nirgends.
 *
 * FUENF QUELLEN FUER POSTEN, in dieser Reihenfolge:
 *
 *   0a. LAUFENDER MONAT (0120, 23.09.2026) — nur Berichte mit
 *      `laufenderMonat` (heute: 97). Jede Nacht der Zeitraum vom Monatsersten
 *      bis zum Vortag (`heute - 1`, der letzte abgeschlossene Geschaeftstag),
 *      fuer jeden Betrieb mit Umsatz in diesem Zeitraum. Tagesgeschaeft
 *      (`nachladen = false`), rund 62 Aufrufe je Nacht. Der Abruf ist
 *      VORLAEUFIG (`abrufVorlaeufig()`), und der naechste ersetzt ihn: der
 *      Lader loescht von..bis und die enthaltenen Abrufzeilen. Am Monatsersten
 *      ist der Vortag der Monatsletzte — dann ist dieser Posten der ganze
 *      Vormonat, mit genau dem Schluessel des spaeteren Erstabrufs.
 *   0b. VORLAEUFIGE NACHZIEHEN — jede vorlaeufige Abrufzeile, die kein offener
 *      Posten enthaelt, wird jede Nacht neu geholt, bis ein Abruf nach der
 *      Reife sie endgueltig macht. So wird der Vormonat bis Monatsende + 7
 *      jede Nacht aufgefrischt, und der Abruf an diesem Tag ist endgueltig —
 *      derselbe Tag, an dem der Erstabruf ihn fuer reif hielte — ohne dass
 *      der Erstabruf ihn kennen muss (der sieht einen Posten mit demselben
 *      Schluessel und reiht nichts ein; das ist hier richtig). Nicht erneut,
 *      wenn seit dem letzten Laden schon ein Posten dafuer lief (keine_daten,
 *      Fehler) oder in den letzten 20 Stunden einer angelegt wurde.
 *   1. GEGENPROBE (`mart.betriebsbericht_gegenprobe`, nachholen = 'faellig'):
 *      LINAs Summe traf den Umsatzbericht nicht. Neu eingereiht mit Nacharbeit-
 *      Prioritaet, hoechstens dreimal, fruehestens eine Woche nach dem letzten
 *      Abruf, nur fuer die letzten 60 Tage — wie die Nulltage aus 0100. Kein
 *      Fehler im Posten, der in Minuten wiederholt wuerde: ein zu frueh
 *      geholter Tag wird in Minuten nicht voller. Seit 0121 NICHT, wenn der
 *      Fehler in unserem Umsatzbericht liegt (Lochtag oder Nulltag im
 *      Zeitraum, LINAs Summe hoeher): die Sicht sagt dann
 *      'umsatzbericht lueckenhaft' und nachholen NULL — 21./22.07.2026 haetten
 *      sonst ~2.800 Aufrufe ohne Ertrag gekostet.
 *   2. NACHLAUF: ein Zeitraum, dessen LETZTER (bis 0120: erster) Abruf vor Ende +
 *      NACHLAUF_TAGE lag, wird danach genau einmal neu geholt — das
 *      Nachzuegler-Fenster der Betriebsberichte. Fuer den Backfill faellt das
 *      weg (sein erster Abruf liegt ohnehin Monate nach dem Zeitraum). Bis
 *      0120 hiess die Bedingung „genau ein Abruf, und der vor Ende + N"; ein
 *      Monat, der ueber 0a/0b sieben Mal vorlaeufig geholt wurde, bekaeme
 *      damit nie seinen Nachlauf. „Der letzte Abruf lag vor Ende + N" ist fuer
 *      den bisherigen Fall dieselbe Bedingung.
 *   3. ERSTABRUF, getrieben von Betrieb-Tagen MIT UMSATZ — und zwar der
 *      VEREINIGUNG aus Umsatzbericht und Artikelverkauf (Plan 5.2, die Falle
 *      darin: ein Tag, den der Umsatzbericht nicht kennt, wuerde sonst nie
 *      gefragt; der 22.07.2026 stand sieben Wochen bei allen Betrieben auf
 *      null). Ein Zeitraum ist faellig, wenn sein Ende REIFE_TAGE zurueckliegt.
 *      Gefragt wird, ob es fuer genau diesen Zeitraum JE einen Posten gab —
 *      gleich mit welchem Ausgang (ein Takt am Ergebniswert kennt immer einen
 *      vergessenen Ausgang, fehlerkatalog.md, 12.08.2026).
 *
 * NEUESTE ZUERST, UEBER ALLE BETRIEBE GEMEINSAM. Die Monate werden absteigend
 * abgearbeitet, und innerhalb eines Monats ordnet `sync.posten_holen()` nach
 * Datum absteigend. Nach der ersten Nacht ist der juengste Monat fuer ALLE
 * Betriebe da, nicht ein Betrieb fuer alle Jahre; bricht der Zugang ab, fehlt
 * das Unwichtigste. `ORDER BY von DESC` — ein Test prueft es.
 *
 * DIE OBERGRENZE ZAEHLT DIE OFFENEN MIT. `BETRIEBSBERICHT_JE_LAUF` minus die
 * noch offenen Betriebsbericht-Posten — sonst wuechse die Schlange jede Nacht
 * um das, was der Lauf nicht geschafft hat. Voreinstellung ist das
 * Tagesbudget: begrenzt wird die Nacht vom Budget, nicht von dieser Zahl (E8).
 */
export async function betriebsberichteNachfuellen(
  heute: string = geschaeftstag(new Date()),
): Promise<number> {
  await abgeschalteteBetriebsberichteSchliessen()
  const grenze = config.BETRIEBSBERICHT_JE_LAUF
  if (grenze === 0 || AKTIVE_BETRIEBSBERICHTE.length === 0) return 0
  const keys = AKTIVE_BETRIEBSBERICHTE.map(b => b.key)

  const offen = await eine<{ n: number }>(
    `SELECT count(*)::int AS n FROM sync.warteschlange
      WHERE erledigt_am IS NULL AND endpunkt LIKE 'getReport:%'`)
  let uebrig = grenze - Number(offen?.n ?? 0)
  if (uebrig <= 0) {
    log.info('betriebsberichte: schlange voll, nichts neu eingereiht', {
      offen: Number(offen?.n ?? 0), grenze,
    })
    return 0
  }
  let gegenprobe = 0, nachlauf = 0, erst = 0, laufenderMonat = 0, vorlaeufig = 0

  /*
   * TAGESGESCHÄFT ODER NACHLADEN (0116, Entscheidung 23.09.2026). Laufend
   * sind die Tages- und Wochenberichte (Klasse T/W), deren Zeitraum in den
   * letzten BETRIEBSBERICHT_LAUFEND_TAGE endet — sie laufen in Phase A, vor
   * den Auswertungen, damit neue Tage täglich ankommen. Alles andere läuft in
   * Phase C, danach. Die Gegenprobe (1.) bleibt Tagesgeschäft: sie ist
   * Nacharbeit an den letzten 60 Tagen und klein. Begründung der Grenze bei
   * `BETRIEBSBERICHT_LAUFEND_TAGE` in src/config.ts.
   */
  const laufendKeys = AKTIVE_BETRIEBSBERICHTE
    .filter(b => b.klasse === 'T' || b.klasse === 'W').map(b => b.key)
  const laufendAbDatum = new Date(`${heute}T00:00:00Z`)
  laufendAbDatum.setUTCDate(laufendAbDatum.getUTCDate() - config.BETRIEBSBERICHT_LAUFEND_TAGE)
  const laufendAb = laufendAbDatum.toISOString().slice(0, 10)

  // 0a. Laufender Monat bis zum Vortag, vorlaeufig
  const monatKeys = AKTIVE_BETRIEBSBERICHTE.filter(b => b.laufenderMonat).map(b => b.key)
  const vortagD = new Date(`${heute}T00:00:00Z`)
  vortagD.setUTCDate(vortagD.getUTCDate() - 1)
  const vortag = vortagD.toISOString().slice(0, 10)
  const monatsErster = `${vortag.slice(0, 7)}-01`
  if (monatKeys.length > 0) {
    // Einmal je Schluessel, wie der Erstabruf: laeuft der Sync zweimal an
    // einem Geschaeftstag, bleibt es bei einem Abruf; und ein keine_daten
    // wird nicht jede Stunde wiederholt.
    const r = await query<{ posten_id: string }>(
      `WITH tage AS (
         SELECT u.betrieb_key
           FROM core.umsatzbericht_tag u
          WHERE u.geschaeftstag BETWEEN $2::date AND $3::date
            AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
            AND (coalesce(u.umsatz_netto, 0) <> 0 OR coalesce(u.rechnungen, 0) > 0)
         UNION
         SELECT a.betrieb_key
           FROM core.artikelverkauf_tag a
          WHERE a.geschaeftstag BETWEEN $2::date AND $3::date
            AND (coalesce(a.umsatz_netto, 0) <> 0 OR coalesce(a.menge, 0) <> 0)
       )
       INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet, nachladen)
       SELECT e.key, b.enc_id, $2::date, $3::date, $5, false
         FROM (SELECT DISTINCT betrieb_key FROM tage) t
         JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key
        CROSS JOIN unnest($1::text[]) AS e(key)
        WHERE b.enc_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM sync.warteschlange w
               WHERE w.endpunkt = e.key AND w.betrieb_enc_id = b.enc_id
                 AND w.zeitraum_von = $2::date AND w.zeitraum_bis = $3::date)
        ORDER BY b.enc_id, e.key
        LIMIT $4
       RETURNING posten_id`,
      [monatKeys, monatsErster, vortag, uebrig, PRIORITAET.betriebsbericht])
    laufenderMonat = r.length
    uebrig -= laufenderMonat
  }

  // 0b. Vorlaeufige Abrufe nachziehen, bis sie endgueltig sind
  if (uebrig > 0) {
    const r = await query<{ posten_id: string }>(
      `INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet, nachladen)
       SELECT a.endpunkt, b.enc_id, a.zeitraum_von, a.zeitraum_bis, $3, false
         FROM core.betriebsbericht_abruf a
         JOIN core.betrieb b ON b.betrieb_key = a.betrieb_key
        WHERE a.vorlaeufig
          AND a.endpunkt = ANY($1::text[])
          AND a.zeitraum_bis >= $4::date - 60
          AND b.enc_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM sync.warteschlange w
               WHERE w.endpunkt = a.endpunkt AND w.betrieb_enc_id = b.enc_id
                 AND (
                      -- ein offener Posten, der den Zeitraum enthaelt (0a von heute)
                      (w.erledigt_am IS NULL
                       AND w.zeitraum_von <= a.zeitraum_von AND w.zeitraum_bis >= a.zeitraum_bis)
                   OR (w.zeitraum_von = a.zeitraum_von AND w.zeitraum_bis = a.zeitraum_bis
                       -- seit dem letzten Laden schon versucht, oder heute schon angelegt
                       AND (w.erstellt_am > a.zuletzt_abgerufen_am
                            OR w.erstellt_am > now() - interval '20 hours'))))
        ORDER BY a.zeitraum_bis DESC, a.endpunkt, b.enc_id
        LIMIT $2
       ON CONFLICT DO NOTHING
       RETURNING posten_id`,
      [keys, uebrig, PRIORITAET.betriebsbericht, heute])
    vorlaeufig = r.length
    uebrig -= vorlaeufig
  }

  // 1. Gegenprobe nachholen
  const g = await query<{ endpunkt: string }>(
    `WITH f AS (
       SELECT endpunkt, betrieb_key, zeitraum_von, zeitraum_bis
         FROM mart.betriebsbericht_gegenprobe
        WHERE zeitraum_bis >= $4::date - 60 AND nachholen = 'faellig'
          AND endpunkt = ANY($1::text[])
        ORDER BY zeitraum_bis DESC, endpunkt
        LIMIT $2),
     ein AS (
       INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet)
       SELECT f.endpunkt, b.enc_id, f.zeitraum_von, f.zeitraum_bis, $3
         FROM f JOIN core.betrieb b ON b.betrieb_key = f.betrieb_key
       ON CONFLICT DO NOTHING
       RETURNING endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis)
     UPDATE core.betriebsbericht_abruf a
        SET nachgeholt = a.nachgeholt + 1
       FROM ein JOIN core.betrieb b ON b.enc_id = ein.betrieb_enc_id
      WHERE a.endpunkt = ein.endpunkt AND a.betrieb_key = b.betrieb_key
        AND a.zeitraum_von = ein.zeitraum_von AND a.zeitraum_bis = ein.zeitraum_bis
     RETURNING a.endpunkt`,
    [keys, uebrig, PRIORITAET.nacharbeit, heute])
  gegenprobe = g.length
  uebrig -= gegenprobe

  // 2. Nachlauf: einmal neu, wenn der erste Abruf vor Ende + NACHLAUF_TAGE lag
  if (uebrig > 0 && config.BETRIEBSBERICHT_NACHLAUF_TAGE > 0) {
    const r = await query<{ posten_id: string }>(
      `INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet, nachladen)
       SELECT a.endpunkt, b.enc_id, a.zeitraum_von, a.zeitraum_bis, $4,
              NOT (a.endpunkt = ANY($6::text[]) AND a.zeitraum_bis >= $7::date)
         FROM core.betriebsbericht_abruf a
         JOIN core.betrieb b ON b.betrieb_key = a.betrieb_key
        WHERE a.endpunkt = ANY($1::text[])
          AND NOT a.vorlaeufig
          AND a.zeitraum_bis >= $5::date - 60
          AND a.zeitraum_bis + $2::int <= $5::date
          -- Der LETZTE Abruf lag vor Ende + N (0120; vorher: genau einer, und
          -- der erste davor — fuer diesen Fall dieselbe Bedingung).
          AND a.zuletzt_abgerufen_am < (a.zeitraum_bis + $2::int)::timestamptz
        ORDER BY a.zeitraum_bis DESC, a.endpunkt
        LIMIT $3
       ON CONFLICT DO NOTHING
       RETURNING posten_id`,
      [keys, config.BETRIEBSBERICHT_NACHLAUF_TAGE, uebrig, PRIORITAET.betriebsbericht, heute,
       laufendKeys, laufendAb])
    nachlauf = r.length
    uebrig -= nachlauf
  }

  // 3. Erstabruf, Monat fuer Monat rueckwaerts
  const reif = new Date(`${heute}T00:00:00Z`)
  reif.setUTCDate(reif.getUTCDate() - config.BETRIEBSBERICHT_REIFE_TAGE)
  const reifBis = reif.toISOString().slice(0, 10)
  const endpunkte = JSON.stringify(AKTIVE_BETRIEBSBERICHTE.map(b => ({ key: b.key, klasse: b.klasse })))
  const monat = new Date(`${reifBis.slice(0, 7)}-01T00:00:00Z`)
  const ab = `${config.HISTORIE_AB.slice(0, 7)}-01`
  while (uebrig > 0 && monat.toISOString().slice(0, 10) >= ab) {
    const m = monat.toISOString().slice(0, 10)
    const r = await query<{ posten_id: string }>(
      `WITH tage AS (
         SELECT u.betrieb_key, u.geschaeftstag
           FROM core.umsatzbericht_tag u
          WHERE u.geschaeftstag >= $1::date AND u.geschaeftstag < ($1::date + interval '1 month')
            AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
            AND (coalesce(u.umsatz_netto, 0) <> 0 OR coalesce(u.rechnungen, 0) > 0)
         UNION
         SELECT a.betrieb_key, a.geschaeftstag
           FROM core.artikelverkauf_tag a
          WHERE a.geschaeftstag >= $1::date AND a.geschaeftstag < ($1::date + interval '1 month')
            AND (coalesce(a.umsatz_netto, 0) <> 0 OR coalesce(a.menge, 0) <> 0)
       ), ep AS (
         SELECT * FROM jsonb_to_recordset($2::jsonb) AS e(key text, klasse text)
       ), einheit AS (
         SELECT DISTINCT e.key, b.enc_id,
                CASE e.klasse
                  WHEN 'T' THEN t.geschaeftstag
                  WHEN 'W' THEN date_trunc('week', t.geschaeftstag)::date
                  ELSE date_trunc('month', t.geschaeftstag)::date
                END AS von,
                CASE e.klasse
                  WHEN 'T' THEN t.geschaeftstag
                  WHEN 'W' THEN (date_trunc('week', t.geschaeftstag) + interval '6 days')::date
                  ELSE (date_trunc('month', t.geschaeftstag) + interval '1 month - 1 day')::date
                END AS bis
           FROM tage t
           JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key
          CROSS JOIN ep e
          WHERE b.enc_id IS NOT NULL
       )
       INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet, nachladen)
       SELECT x.key, x.enc_id, x.von, x.bis, $5,
              NOT (x.key = ANY($6::text[]) AND x.bis >= $7::date)
         FROM einheit x
        WHERE x.bis <= $3::date
          AND NOT EXISTS (
              SELECT 1 FROM sync.warteschlange w
               WHERE w.endpunkt = x.key AND w.betrieb_enc_id = x.enc_id
                 AND w.zeitraum_von = x.von AND w.zeitraum_bis = x.bis)
        ORDER BY x.von DESC, x.key, x.enc_id
        LIMIT $4
       RETURNING posten_id`,
      [m, endpunkte, reifBis, uebrig, PRIORITAET.betriebsbericht, laufendKeys, laufendAb])
    erst += r.length
    uebrig -= r.length
    monat.setUTCMonth(monat.getUTCMonth() - 1)
  }

  const n = laufenderMonat + vorlaeufig + gegenprobe + nachlauf + erst
  if (n > 0) {
    log.info('betriebsberichte eingereiht', {
      laufender_monat: laufenderMonat, vorlaeufig_nachgezogen: vorlaeufig,
      gegenprobe, nachlauf, erstabruf: erst, bis_monat: monat.toISOString().slice(0, 7),
      grenze, sicht: 'mart.backfill_fortschritt',
    })
  }
  return n
}

/**
 * Offene Posten abgeschalteter Betriebsberichte schliessen (0119, 23.09.2026).
 *
 * ANLASS. Bericht 88 wurde abgeschaltet (`aktiv: false`), die Finanzwege
 * kommen nur noch aus 97. `aktiv: false` verhindert das Einreihen — nicht
 * aber, dass ein schon eingereihter Posten gezogen wird: der Worker findet
 * den Endpunkt ueber das Register, und das behaelt den Eintrag, weil der
 * Lader alte Rohantworten weiter verarbeiten muss (harte Regel 4). Die
 * Migration 0119 schliesst die offenen 88-Posten einmal; dieser Schritt
 * haelt es so fuer jeden Posten, der danach noch auftaucht — etwa einen, der
 * beim Deploy `in_arbeit` stand und eine Stunde spaeter freigegeben wird.
 * Wer kuenftig einen Betriebsbericht abschaltet, braucht dafuer keine
 * Migration mehr.
 *
 * `ergebnis = 'abgeschaltet'` und nicht `aufgegeben`: ein aufgegebener Posten
 * wird wiederbelebt und steht in `mart.posten_aufgegeben` — beides waere hier
 * falsch. Nicht angefasst werden Posten in Arbeit: den schliesst der Worker
 * selbst, und ein zweiter Schreiber auf derselben Zeile waere ein Wettlauf.
 * Wirft nicht nach oben ab — der Aufrufer faengt, wie alle Nachfuellschritte.
 */
export async function abgeschalteteBetriebsberichteSchliessen(): Promise<number> {
  const aus = BETRIEBSBERICHTE.filter(b => !b.aktiv).map(b => b.key)
  if (aus.length === 0) return 0
  const r = await query<{ endpunkt: string }>(
    `UPDATE sync.warteschlange
        SET erledigt_am = now(), ergebnis = 'abgeschaltet'
      WHERE endpunkt = ANY($1::text[])
        AND erledigt_am IS NULL AND in_arbeit_seit IS NULL
     RETURNING endpunkt`,
    [aus])
  if (r.length > 0) {
    const jeEndpunkt: Record<string, number> = {}
    for (const z of r) jeEndpunkt[z.endpunkt] = (jeEndpunkt[z.endpunkt] ?? 0) + 1
    log.info('posten abgeschalteter betriebsberichte geschlossen', { jeEndpunkt })
  }
  return r.length
}

/**
 * Das Orakel fuer Nulltage: der Tagesbericht mit dem laengsten Fenster.
 * Kennt er fuer einen Betrieb und Tag Umsatz, den der Umsatzbericht nicht
 * kennt, hat die Kasse nachgeliefert, nachdem das kurze Fenster zu war.
 */
const NULLTAG_ORAKEL = 'getArtikelverkaufsbericht'

/**
 * Nulltage nachholen (seit 10.09.2026, Migration `0100`).
 *
 * DER FALL. Eine Kasse faellt aus oder liefert nicht hoch; LINA fuehrt den
 * Betrieb an diesen Tagen mit null. Kommt die Nachlieferung erst nach mehr
 * als NACHZUEGLER_TAGE (10) Tagen, hat der taegliche Lauf den Umsatzbericht
 * dieser Tage zum letzten Mal geholt, als er noch null war — und holt ihn
 * nie wieder. `historieNachziehen()` hilft nicht: es prueft, ob je ein
 * Posten existierte, nicht, ob er etwas brachte. Der Artikelverkaufsbericht
 * dagegen laeuft 21 Tage nach und hat die Nachlieferung gesehen.
 *
 * Gemessen am 10.09.2026: Aposto Schwetzingen 04.–14.08. (45.486 EUR netto
 * im Artikelverkauf, 0 im Umsatzbericht) und Enchilada Aschaffenburg
 * 31.07.–10.08. (37.570 EUR). Beide standen so im Round Table.
 *
 * WAS PASSIERT. `mart.umsatztag_luecke` nennt die Tage (`zustand =
 * 'faellig'`). Jeder davon wird fuer JEDEN Konzern-Tagesbericht neu
 * eingereiht, dessen Fenster den Tag nicht mehr erreicht — der Umsatzbericht
 * mit allen Hauptsparten, die Zeitzonen, die Aktionen. Nicht das Orakel
 * selbst, und nichts, was der taegliche Lauf ohnehin holt. Ein Tag ist ein
 * Konzernbericht, also ein Aufruf je Endpunkt fuer alle 141 Betriebe.
 *
 * DREI GRENZEN. Hoechstens NULLTAGE_JE_LAUF Tage je Nacht (ein Tag kostet bis
 * zu 14 Aufrufe). Ein Tag, der nach dem Nachholen weiter null steht, wartet
 * eine Woche (`wartet`) und wird nach dem dritten Versuch nicht mehr
 * angefasst (`aufgegeben`) — die Pruefuebersicht zaehlt genau diese. Und
 * was laenger ausfaellt als das Fenster des Orakels (21 Tage), sieht auch
 * diese Sicht nicht: dann stehen beide Berichte auf null.
 */
export async function nulltageNachziehen(): Promise<number> {
  if (config.NULLTAGE_JE_LAUF === 0) return 0
  const tage = await query<{ tag: string; alter_tage: number; betriebe: number }>(
    `SELECT geschaeftstag::text AS tag,
            min(alter_tage)::int  AS alter_tage,
            count(*)::int         AS betriebe
       FROM mart.umsatztag_luecke
      WHERE zustand = 'faellig'
      GROUP BY geschaeftstag
      ORDER BY geschaeftstag DESC
      LIMIT $1`,
    [config.NULLTAGE_JE_LAUF])
  if (tage.length === 0) return 0

  let n = 0
  for (const ep of AKTIVE_ENDPUNKTE) {
    if (ep.schrittweite !== 'tag' || ep.ebene !== 'konzern' || ep.key === NULLTAG_ORAKEL) continue
    const fenster = ep.nachzuegler_tage ?? config.NACHZUEGLER_TAGE
    for (const t of tage) {
      // Was das eigene Fenster noch erreicht, holt der taegliche Lauf selbst.
      if (t.alter_tage <= fenster) continue
      const r = await query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
         VALUES ($1, $2, $2, $3) ON CONFLICT DO NOTHING RETURNING posten_id`,
        [ep.key, t.tag, PRIORITAET.nacharbeit])
      n += r.length
    }
  }
  log.info('nulltage nachgezogen', {
    tage: tage.map(t => `${t.tag} (${t.betriebe} Betriebe)`),
    posten: n, sicht: 'mart.umsatztag_luecke',
  })
  return n
}

/**
 * Lochtage nachholen — der Fall, den `nulltageNachziehen()` nicht sieht.
 *
 * DER FALL. Der Lauf holt einen Geschaeftstag, bevor LINA ihn hat, und das
 * Fenster erreicht ihn danach nie wieder. Dann stehen BEIDE Berichte leer,
 * und die Luecke oben (Artikelverkauf kennt Umsatz, Umsatzbericht nicht)
 * hat nichts zu vergleichen. Gemessen am 14.09.2026: 20.–22.07.2026, am
 * 26.07. im ersten Lauf vier bis sechs Tage nach dem Geschaeftstag geholt —
 * der 23.07. kam im selben Lauf ebenso leer und war am 02.08. voll —, das
 * taegliche Fenster begann am 02.08. und reichte bis zum 23.07. Der 22.07.
 * stand sieben Wochen bei allen 141 Betrieben auf null, in jeder Auswertung.
 *
 * DAS SIGNAL ist der Umsatzbericht selbst: `mart.umsatz_lochtag` (seit 0039
 * die Karte "Tage mit Datenloch", seit 0101 mit Zustand) nennt Tage, an denen
 * weniger als 60 % der Betriebe Umsatz melden, die es im 28-Tage-Schnitt
 * davor taten. Deshalb gibt es hier kein Orakel und keine Ausnahme: jeder
 * faellige Tag wird fuer JEDEN aktiven Konzern-Tagesbericht eingereiht,
 * dessen Fenster ihn nicht mehr erreicht — auch fuer den Artikelverkauf.
 *
 * DIESELBEN DREI GRENZEN wie bei den Nulltagen: hoechstens LOCHTAGE_JE_LAUF
 * Tage je Nacht (ein Tag kostet bis zu 16 Aufrufe), eine Woche `wartet`
 * nach einem Nachholen ohne Ertrag, `aufgegeben` nach dem dritten — dann
 * hat LINA den Tag wirklich nicht, und die Pruefuebersicht zaehlt ihn.
 */
export async function lochtageNachziehen(): Promise<number> {
  if (config.LOCHTAGE_JE_LAUF === 0) return 0
  const tage = await query<{ tag: string; alter_tage: number; betriebe: number; erwartet: number }>(
    `SELECT geschaeftstag::text     AS tag,
            alter_tage::int         AS alter_tage,
            betriebe_mit_umsatz::int AS betriebe,
            betriebe_erwartet::int  AS erwartet
       FROM mart.umsatz_lochtag
      WHERE zustand = 'faellig'
      ORDER BY geschaeftstag DESC
      LIMIT $1`,
    [config.LOCHTAGE_JE_LAUF])
  if (tage.length === 0) return 0

  let n = 0
  for (const ep of AKTIVE_ENDPUNKTE) {
    if (ep.schrittweite !== 'tag' || ep.ebene !== 'konzern') continue
    const fenster = ep.nachzuegler_tage ?? config.NACHZUEGLER_TAGE
    for (const t of tage) {
      if (t.alter_tage <= fenster) continue
      const r = await query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
         VALUES ($1, $2, $2, $3) ON CONFLICT DO NOTHING RETURNING posten_id`,
        [ep.key, t.tag, PRIORITAET.nacharbeit])
      n += r.length
    }
  }
  log.info('lochtage nachgezogen', {
    tage: tage.map(t => `${t.tag} (${t.betriebe} von ${t.erwartet} Betrieben)`),
    posten: n, sicht: 'mart.umsatz_lochtag',
  })
  return n
}

/**
 * Monatliche Nachlese fuer Tagesberichte, die sich noch aendern, wenn ihr
 * Fenster laengst zu ist (`nachlese_tage` in `src/lina/endpunkte.ts`).
 *
 * Der Anlass: getPersonalkosten aenderte sich am 10.09.2026 an Tag 22 — dem
 * letzten Tag seines 21-Tage-Fensters — noch bei 24 von 30 Abrufen, und
 * zwar mit echten Werten (pekGesamt, effGesamt), nicht mit Rauschen. Lohn
 * schliesst monatlich ab; ein taegliches Fenster, das lang genug waere,
 * kostete 20 Sekunden je Aufruf und Tag. Stattdessen einmal im Monat die
 * Tage zwischen Fensterende und `nachlese_tage` zurueck — fuer
 * Personalkosten 41 Aufrufe, rund 15 Minuten, einmal.
 *
 * Der Merker `nachlese:<endpunkt>` traegt den Monat, in dem zuletzt
 * eingereiht wurde; ein Lauf, der ihn liest, reiht im selben Monat nicht
 * noch einmal ein.
 */
export async function nachleseNachziehen(): Promise<number> {
  if (config.NACHLESE_JE_LAUF === 0) return 0
  const monat = geschaeftstag(new Date()).slice(0, 7)
  let n = 0
  for (const ep of AKTIVE_ENDPUNKTE) {
    if (ep.schrittweite !== 'tag' || !ep.nachlese_tage) continue
    if (n >= config.NACHLESE_JE_LAUF) break
    const schluessel = `nachlese:${ep.key}`
    const stand = await eine<{ wert: { monat?: string } | null }>(
      `SELECT wert FROM sync.merker WHERE schluessel = $1`, [schluessel])
    if (stand?.wert?.monat === monat) continue

    const fenster = ep.nachzuegler_tage ?? config.NACHZUEGLER_TAGE
    const r = await query<{ posten_id: string }>(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       SELECT $1, t::date, t::date, $4
         FROM generate_series(current_date - $2::int, current_date - $3::int - 1, interval '1 day') t
        ORDER BY t DESC
        LIMIT $5
       ON CONFLICT DO NOTHING RETURNING posten_id`,
      [ep.key, ep.nachlese_tage, fenster, PRIORITAET.nacharbeit, config.NACHLESE_JE_LAUF - n])
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ($1, jsonb_build_object('monat', $2::text, 'am', now(), 'posten', $3::int))
       ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`,
      [schluessel, monat, r.length])
    log.info('nachlese eingereiht', { endpunkt: ep.key, posten: r.length, tage: ep.nachlese_tage, monat })
    n += r.length
  }
  return n
}

/**
 * FoodNotify: der laufende Abgleich.
 *
 * WAS HIER GEHOLT WIRD UND WARUM GENAU DAS.
 *
 * Der Backfill arbeitet die Seiten ab, die es beim Start gab. Neue
 * Bestellungen entstehen bei FoodNotify aber auf NEUEN Seiten am Ende
 * der Liste (sortiert nach timeCreated ASC) — die kennt niemand, und
 * ohne diesen Abgleich fehlten sie für immer.
 *
 * Geholt wird deshalb je Kostenstelle die LETZTE Seite: dort stehen die
 * neuesten Bestellungen. Ihr Laden reiht Köpfe und Positionen für alles
 * ein, was dort neu auftaucht — dieselbe Mechanik wie im Backfill, nur
 * am anderen Ende.
 *
 * Die Seitenzahl steht nicht fest: kommen Bestellungen dazu, wächst sie.
 * Sie wird deshalb bei jedem Lauf neu aus `gesamt` abgeleitet, nicht
 * gespeichert.
 */
export async function foodnotifyNachfuellen(): Promise<number> {
  const zugaenge = fnZugaenge()
  if (zugaenge.length === 0) return 0

  const heute = geschaeftstag(new Date())
  let n = 0

  for (const z of zugaenge) {
    const marke = await eine<{ marke_key: number }>(
      `SELECT marke_key FROM core.marke WHERE schluessel = $1`, [z.schluessel])
    if (!marke) continue

    /**
     * Die Organisationsposten (A1) auffrischen: neue Betriebe, neue
     * Kostenstellen, neu angeschlossene Kassen.
     *
     * TÄGLICH SEIT DEM 13.08.2026, VORHER MONATLICH. Der Monatstakt war als
     * „täglich wäre Verschwendung" begründet, und das war an den Aufrufen
     * gemessen richtig und an der Wirkung falsch: eine neue Kostenstelle
     * blieb bis zu vier Wochen ohne `betrieb_key`, und ihr Einkauf fiel so
     * lange aus jeder betriebsbezogenen Sicht. Gemessen am 13.08.2026 lagen
     * die Stammdaten 11 Tage zurück.
     *
     * Die Verschwendung ist zudem winzig: vier Endpunkte mal vier Marken
     * sind 16 Aufrufe am Tag, gegen ein FoodNotify-Tagesbudget von 140.000
     * bei rund 200 verbrauchten. Das ist der billigste Punkt dieses ganzen
     * Plans.
     *
     * `fn:profil` KAM AM 14.08.2026 DAZU und war bis dahin ein Einmalposten:
     * vier Aufgaben insgesamt, alle vom 02.08.2026, danach nie wieder. Es
     * liefert die FoodNotify-Benutzer-ID, aus der `fnEndpunkt()` die Pfade
     * aller anderen Aufrufe baut — ändert sie sich, laufen die anderen
     * Endpunkte ins Leere, und zwar geschlossen. Ein Einmalposten für eine
     * Angabe, an der alles andere hängt, ist derselbe Bau wie der einmalige
     * Belegarchiv-Abzug vom 12.08.2026.
     *
     * Der Takt hängt weiterhin am ZEITRAUM und nicht an einem Ergebniswert —
     * gibt es für heute schon eine Zeile, passiert nichts, gleich wie sie
     * ausgegangen ist. Dieselbe Lehre wie bei `einreihenJeMonat()`.
     */
    const { fnEndpunkt } = await import('../foodnotify/endpunkte')
    for (const ep of ['fn:profil', 'fn:betriebe', 'fn:kostenstellen', 'fn:pos_standorte']) {
      const r = await query(
        `INSERT INTO sync.warteschlange
           (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
         SELECT $1, $2::date, $2::date, $4, $3, '{}'::jsonb
          WHERE NOT EXISTS (
                SELECT 1 FROM sync.warteschlange w
                 WHERE w.endpunkt = $1 AND w.marke_key = $3
                   AND w.parameter = '{}'::jsonb
                   AND w.zeitraum_von = $2::date)
         RETURNING posten_id`,
        [ep, heute, marke.marke_key, fnEndpunkt(ep).prioritaet])
      n += r.length
    }

    /**
     * Die jeweils letzte Bestellseite je Kostenstelle.
     *
     * Priorität 20: klar VOR dem Backfill (89/90), damit neue
     * Bestellungen nicht hinter 36.000 Altposten warten — und klar HINTER
     * LINAs Tagesdaten (10), die zeitkritischer sind.
     *
     * Nur Kostenstellen mit bekannter Seitenzahl: solange der Backfill
     * die erste Seite einer Kostenstelle nicht geholt hat, ist sie
     * unbekannt — und der Backfill deckt diese Kostenstelle ohnehin
     * gerade selbst ab.
     *
     * `page_count` kommt AUS DER ANTWORT, wird also nicht aus der
     * Gesamtzahl und einer angenommenen Seitengröße gerechnet. Die
     * Seitengröße ist eine Annahme über fremdes Verhalten; die
     * Seitenzahl ist eine Aussage des Servers.
     *
     * Der Pfad ist `payload->'payload'`: raw speichert die Antwort MIT
     * Hülle, und die Zählfelder stehen innerhalb der Hülle.
     */
    const seiten = await query<{ erp_id: number; letzte_seite: number }>(
      `SELECT k.erp_id, greatest(1, a.seiten) AS letzte_seite
         FROM core.kostenstelle k
         JOIN LATERAL (
              SELECT (s.payload->'payload'->>'page_count')::int AS seiten
                FROM raw.api_antwort s
               WHERE s.endpunkt = 'fn:bestellungen'
                 AND s.parameter->>'erpId' = k.erp_id::text
                 AND s.payload->'payload'->>'page_count' IS NOT NULL
               ORDER BY s.abgerufen_am DESC
               LIMIT 1) a ON true
        WHERE k.marke_key = $1 AND k.erp_id IS NOT NULL`,
      [marke.marke_key])

    /*
     * DIE LETZTEN N SEITEN, NICHT NUR DIE LETZTE — seit Migration 0098.
     *
     * Bis dahin genuegte die letzte Seite: sie sollte nur NEUE Bestellungen
     * finden, und die stehen am Ende (Sortierung timeCreated ASC). Seit 0098
     * ist die Liste zugleich das AUGE des Detailabgleichs — nur was in ihr
     * steht, kann als geaendert erkannt werden. Eine Bestellung, die von der
     * letzten Seite gerutscht ist, bevor ihre Rechnung nachgetragen wurde,
     * fiele sonst durch.
     *
     * Gemessen: eine Seite fasst 25 Bestellungen, die aktivste Kostenstelle
     * hatte in 14 Tagen genau 25 (Median 8, p95 20). Eine Seite deckt den
     * Aenderungszeitraum gerade so ab, zwei mit Abstand. Der Preis sind rund
     * 150 zusaetzliche Listenaufrufe je Nacht — gegen bis zu 5.920
     * eingesparte Detailaufrufe.
     */
    for (const s of seiten) {
      for (let i = 0; i < config.BESTELLDETAIL_LISTENSEITEN; i++) {
        const seite = s.letzte_seite - i
        if (seite < 1) break
        const r = await query(
          `INSERT INTO sync.warteschlange
             (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
           SELECT 'fn:bestellungen', $1::date, $1::date, 20, $2, $3::jsonb
            WHERE NOT EXISTS (
                  SELECT 1 FROM sync.warteschlange w
                   WHERE w.endpunkt = 'fn:bestellungen' AND w.marke_key = $2
                     AND w.parameter = $3::jsonb AND w.erledigt_am IS NULL)
           RETURNING posten_id`,
          [heute, marke.marke_key,
           JSON.stringify({ erpId: String(s.erp_id), seite: String(seite) })])
        n += r.length
      }
    }

    n += await inventurenNachfuellen(marke.marke_key, heute)
    n += await inventurpositionenNachziehen(marke.marke_key)
    n += await bestelldetailsAuffrischen(marke.marke_key)
  }

  return n
}

/**
 * Bestelldetails auffrischen — das rollierende Fenster UND der Nachholauf.
 *
 * DER BEFUND (13.08.2026, lesend in Produktion gemessen). Von 66.966
 * Bestellungen wurde JEDE GENAU EINMAL im Detail geholt, keine einzige je
 * erneut: `sync.aufgabe` zaehlt fuer `fn:bestellung` 66.966 Aufgaben und
 * 66.966 verschiedene `orderId`, mehrfach geholt: null. Liefermenge
 * (`adjustedQuantity`), Lieferdatum, Belegnummer und alle Preisstaende standen
 * damit auf dem Stand des ERSTEN Abrufs — in den Einkaufssichten also
 * laufend Bestellmengen, wo Liefermengen stehen sollten. Der Transform liest
 * `adjustedQuantity` laengst korrekt; es fehlte nur der erneute Abruf.
 *
 * DIE URSACHE IST DIESELBE WIE ÜBERALL IN DIESEM PLAN. Die Detailposten
 * entstehen aus der Bestellliste ueber `folgepostenEinreihen()` mit der Sperre
 * gegen ALLE Posten — die Sperre eines EINMALIGEN Abrufs. Fuer den Backfill
 * war das richtig, als laufender Abgleich ist es falsch. Diese Funktion reiht
 * deshalb an der Sperre vorbei ein, und zwar bewusst: die Wiederholbarkeit
 * steckt hier in `detail_geholt_am`, nicht in der Warteschlange.
 *
 * KEIN HANDBEFEHL, AUCH NICHT FUER DEN ALTBESTAND. Der Nachtrag sah den
 * Nachholauf als zweiten, von Hand gestarteten Lauf vor — wie `--historie`
 * und `--foodnotify`. Die Entscheidung vom 13.08.2026 gilt aber weiter und ist
 * staerker: kein Befehl auf dem Server. Der Nachholauf ist deshalb nur eine
 * OBERGRENZE (`BESTELLDETAIL_JE_LAUF`) im normalen Lauf. Weil JUENGSTE ZUERST
 * genommen werden, ist das rollierende Fenster (gemessen 2.981 Bestellungen)
 * immer zuerst bedient, und der Altbestand arbeitet sich ueber die folgenden
 * Naechte ab. Danach faellt der Verbrauch von selbst auf das Fenster zurueck;
 * es muss nichts abgeschaltet werden.
 *
 * WAS „NICHT FINAL" HEISST. Status weder `canceled` noch `finished`. Gemessen
 * am 13.08.2026: imported 47.340, pending 16.203, canceled 3.350, accepted 61,
 * finished 12. `imported` gilt ausdruecklich als NICHT final — konservativ,
 * solange niemand gemessen hat, ob sich solche Bestellungen noch aendern.
 * Genau das beantwortet der Nachholauf selbst, indem er sie einmal neu holt.
 *
 * SELBSTBEGRENZEND UND SICHTBAR. Wie weit der Nachholauf ist, steht in
 * `mart.bestelldetail_stand.nie_aufgefrischt` — die Zahl MUSS jede Nacht
 * fallen. Ob das Fenster bedient wird, steht als eigene Zeile in
 * `mart.pruefung_uebersicht` (Erwartung 0). Ohne beides saehe ein stiller
 * Ausfall dieser Funktion genauso aus wie „nichts zu tun".
 */
export async function bestelldetailsAuffrischen(markeKey: number): Promise<number> {
  if (config.BESTELLDETAIL_JE_LAUF === 0) return 0

  const r = await query<{ posten_id: number }>(
    `WITH faellig AS (
       SELECT b.fn_id, ks.erp_id,
              coalesce(b.bestellt_am::date, current_date) AS tag
         FROM core.bestellung b
         JOIN core.kostenstelle ks USING (kostenstelle_key)
        WHERE ks.marke_key = $1
          AND ks.erp_id IS NOT NULL
          -- Die Nachholtiefe aus Entscheidung 5. Aelteres bleibt liegen; das
          -- ist eine Grenze und kein Rueckstand.
          AND b.bestellt_am > now() - make_interval(months => $2::int)
          /*
           * DER AUSLOESER SEIT MIGRATION 0098: der Listenstand passt nicht
           * zum Detailstand. Hier stand vorher eine Frist — "alles der
           * letzten 45 Tage, hoechstens einmal am Tag" —, und die holte
           * 2.960 Bestellungen je Nacht, von denen sich 2.144 nachweislich
           * nicht mehr aenderten.
           *
           * Der Statusfilter (NOT IN canceled, finished) ist mit
           * weggefallen und wird nicht vermisst: er griff nie (13 von 67.632
           * Bestellungen stehen je auf 'finished'), und wenn eine Bestellung
           * storniert wird, AENDERT sich ihr Listeneintrag — sie wird dann
           * genau einmal nachgeholt, was richtig ist.
           *
           * detail_geholt_am IS NULL faellt ebenfalls von selbst hierunter:
           * ohne Detailabruf gibt es keinen detail_fingerabdruck, und NULL
           * ist von jedem Wert verschieden.
           */
          AND b.listen_fingerabdruck IS DISTINCT FROM b.detail_fingerabdruck
        -- JUENGSTE ZUERST: dieselbe Entscheidung wie beim Bestell-Backfill
        -- am 02.08.2026 — aktuelle Preise vor der Historie.
        ORDER BY b.bestellt_am DESC
        LIMIT $3
     ), posten AS (
       SELECT ep AS endpunkt, f.tag,
              jsonb_build_object('erpId', f.erp_id::text, 'orderId', f.fn_id) AS parameter
         FROM faellig f
         CROSS JOIN unnest(ARRAY['fn:bestellung', 'fn:bestellpositionen']) AS ep
     )
     INSERT INTO sync.warteschlange
       (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
     SELECT p.endpunkt, p.tag, p.tag, 30, $1, p.parameter
       FROM posten p
      -- NICHT die Alle-Posten-Sperre: die ist genau das Problem. Gesperrt
      -- wird nur ein noch OFFENER Zwilling, damit derselbe Abruf nicht
      -- zweimal gleichzeitig laeuft. Der Wiederholtakt haengt an
      -- detail_geholt_am, also an einer gemessenen Eigenschaft der
      -- Bestellung — nicht an einem Zustand der Warteschlange.
      WHERE NOT EXISTS (
            SELECT 1 FROM sync.warteschlange w
             WHERE w.endpunkt = p.endpunkt AND w.marke_key = $1
               AND w.parameter = p.parameter AND w.erledigt_am IS NULL)
     RETURNING posten_id`,
    [markeKey, config.BESTELLDETAIL_NACHHOLTIEFE_MONATE, config.BESTELLDETAIL_JE_LAUF])

  if (r.length > 0) {
    log.info('bestelldetails aufgefrischt — posten eingereiht', {
      markeKey, posten: r.length, bestellungen: Math.ceil(r.length / 2),
    })
  }
  return r.length
}

/**
 * Inventuren, deren Zaehlung unvollstaendig ist, noch einmal holen.
 *
 * DIE BEDINGUNG IST DIESELBE WIE BEIM BELEGARCHIV: haelt `core.inventurposition`
 * genau so viele Zeilen, wie der Kopf sagt? `anzahl_positionen` kommt aus
 * `totalNumberOfItems` der Inventurliste — es ist FoodNotifys eigene Aussage
 * darueber, wie viele Positionen die Inventur hat, und damit die richtige
 * Gegenprobe.
 *
 * WARUM DAS KEIN HANDBEFEHL IST. Bis zum 13.08.2026 stand hier ein
 * `einreihen --foodnotify-inventurpositionen`, das jemand haette ausloesen
 * muessen. Genau die Bauform hat am 02.08.2026 acht Tage LINA-Stillstand
 * gekostet: ein Schritt, den ein Mensch anstossen muss, faellt irgendwann aus,
 * und sein Ausfall sieht aus wie Ruhe. Der Lauf macht es jetzt selbst.
 *
 * SELBSTBEGRENZEND, UND DAS IST GEMESSEN. Am 13.08.2026 in Produktion:
 * 349 der 358 Inventuren stimmen auf die Position genau ueberein, 9 sind bei
 * exakt 800 abgeschnitten, NULL andere Ausreisser, und keine einzige Inventur
 * ohne Positionen. Die Bedingung feuert also fuer genau die neun und danach
 * fuer keine mehr. Bliebe eine dauerhaft ungleich, kostet sie einen Aufruf je
 * Nacht und steht sichtbar in `mart.inventur_abgeschnitten` — das ist der
 * bewusste Preis dafuer, dass eine echte Luecke nicht vergessen wird.
 *
 * NUR SEITE 1 wird eingereiht; die Folgeseiten reiht das Laden selbst ein.
 * Gesperrt wird gegen jeden OFFENEN Posten derselben Inventur, gleich welcher
 * Seite — sonst stellt der naechste Lauf eine zweite Seite 1, waehrend die
 * erste noch laeuft, und beide loeschen sich gegenseitig die Zaehlung.
 */
export async function inventurpositionenNachziehen(markeKey: number): Promise<number> {
  const r = await query<{ posten_id: number }>(
    `INSERT INTO sync.warteschlange
       (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
     SELECT 'fn:inventurpositionen',
            coalesce(i.erstellt_am::date, current_date),
            coalesce(i.erstellt_am::date, current_date),
            94, $1,
            jsonb_build_object('uuid', i.fn_uuid, 'seite', '1')
       FROM core.inventur i
       JOIN core.kostenstelle ks USING (kostenstelle_key)
       JOIN LATERAL (SELECT count(*) AS geladen FROM core.inventurposition ip
                      WHERE ip.inventur_key = i.inventur_key) p ON true
      WHERE ks.marke_key = $1
        AND i.anzahl_positionen IS NOT NULL
        AND i.anzahl_positionen <> p.geladen
        AND NOT EXISTS (
            SELECT 1 FROM sync.warteschlange w
             WHERE w.endpunkt = 'fn:inventurpositionen'
               AND w.marke_key = $1
               AND w.parameter->>'uuid' = i.fn_uuid
               AND w.erledigt_am IS NULL)
     RETURNING posten_id`,
    [markeKey])

  if (r.length > 0) {
    log.info('inventurzaehlung unvollstaendig — nachgereiht', {
      markeKey, inventuren: r.length,
    })
  }
  return r.length
}

/**
 * Die jeweils letzte Inventurseite einer Marke.
 *
 * WARUM JE MARKE UND NICHT JE KOSTENSTELLE: `fn:inventuren` bündelt alle
 * Kostenstellen in EINEM Aufruf (`erpIds[]`, siehe endpunkte.ts) — es gibt
 * hier also gar keine Seitenzahl je Kostenstelle, sondern nur eine je
 * Marke. Das ist der Grund, warum sich `foodnotifyNachfuellen()` oben nicht
 * einfach wiederverwenden ließ.
 *
 * WARUM DIE LETZTE SEITE: dieselbe Mechanik wie bei den Bestellungen. Die
 * Abfrage sortiert aufsteigend nach `timeCreated`, neue Inventuren landen
 * deshalb am Ende. Wer nur Seite 1 nachzöge, bekäme für immer dieselben
 * ältesten Zählungen.
 *
 * DIE SEITENZAHL STEHT WOANDERS ALS BEI DEN BESTELLUNGEN. `/api/erp/*`
 * liefert die erp-Hülle `{code, errors, isError, payload: {data,
 * pagination}}`, die Seitenzahl also unter `payload.pagination.totalPages`
 * — nicht unter dem flachen `page_count`, das `/api/{erpId}/*` verwendet
 * (huelle.ts unterscheidet beide Formen). Ein Griff an die falsche Stelle
 * liefert hier NULL und keinen Fehler: der Abgleich liefe dann still ins
 * Leere, genau wie das erste Auspacken bei Wilma Wunder 275 Inventuren
 * übersah.
 *
 * `coalesce(…, 1)`: solange keine Antwort mit Seitenangabe vorliegt, ist
 * Seite 1 die richtige Wahl — sie ist bei einer einseitigen Liste zugleich
 * die letzte, und bei noch nie geholten Marken der Einstieg.
 *
 * DIE MARKE STEHT IM PARAMETER-JSON, nicht in einer eigenen Spalte:
 * `raw.api_antwort` hat kein `marke_key` (die Tabelle stammt aus der
 * LINA-Zeit, wo es nur einen Mandanten gab). Der Worker legt sie als
 * `parameter->>'markeKey'` ab.
 *
 * Priorität 20 wie bei den Bestellungen: vor dem Backfill (94/95), hinter
 * LINAs Tagesdaten (10).
 */
export async function inventurenNachfuellen(
  markeKey: number, heute: string,
): Promise<number> {
  const stand = await eine<{ letzte_seite: number; erp_ids: string | null }>(
    `SELECT coalesce((
              SELECT (s.payload->'payload'->'pagination'->>'totalPages')::int
                FROM raw.api_antwort s
               WHERE s.endpunkt = 'fn:inventuren'
                 -- Die Spalte casten, NICHT den Parameter: $1 wird unten
                 -- als integer gegen k.marke_key verwendet, und Postgres
                 -- legt den Typ eines Parameters für die ganze Abfrage
                 -- fest. Ein $1::text hier hiesse "integer = text" dort.
                 AND (s.parameter->>'markeKey')::int = $1
                 AND s.payload->'payload'->'pagination'->>'totalPages' IS NOT NULL
               ORDER BY s.abgerufen_am DESC
               LIMIT 1), 1) AS letzte_seite,
            (SELECT string_agg(k.erp_id::text, ',' ORDER BY k.erp_id)
               FROM core.kostenstelle k
              WHERE k.marke_key = $1 AND k.erp_id IS NOT NULL) AS erp_ids`,
    [markeKey])

  // Ohne Kostenstellen gäbe es keine erpIds — der Pfadbau würfe beim
  // Abarbeiten. Dann ist der Bestellungs-Backfill dieser Marke ohnehin
  // noch nicht gelaufen.
  if (!stand?.erp_ids) return 0

  const parameter = JSON.stringify({
    erpIds: stand.erp_ids,
    seite: String(Math.max(1, stand.letzte_seite)),
  })

  const r = await query(
    `INSERT INTO sync.warteschlange
       (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
     SELECT 'fn:inventuren', $1::date, $1::date, 20, $2, $3::jsonb
      WHERE NOT EXISTS (
            SELECT 1 FROM sync.warteschlange w
             WHERE w.endpunkt = 'fn:inventuren' AND w.marke_key = $2
               AND w.parameter = $3::jsonb AND w.erledigt_am IS NULL)
     RETURNING posten_id`,
    [heute, markeKey, parameter])

  return r.length
}

/**
 * Beides nachfüllen. Wirft NIE — ein Fehler beim Nachfüllen darf den
 * Lauf nicht verhindern: die Warteschlange enthält in aller Regel noch
 * Arbeit, und die soll getan werden. Gemeldet wird er trotzdem.
 */
/**
 * Ladenakte nachfuellen — Belegarchiv, BWA-Historie, Stammdatenblatt.
 *
 * KEIN HANDBEFEHL. Alles hier laeuft ueber mehrere Sync-Laeufe von selbst
 * durch — kein `einreihen --ladenakte`, das jemand ausloesen muesste und
 * dessen Ausfall niemandem auffiele. Genau daran stand LINA am 02.08.2026
 * acht Tage still.
 *
 * `WHERE NOT EXISTS` statt `ON CONFLICT DO NOTHING`: der Eindeutigkeitsindex
 * auf der Warteschlange ist partiell (`WHERE erledigt_am IS NULL`), ein
 * Konflikt-Insert reiht also alles Erledigte erneut ein. Welche Zustaende das
 * NOT EXISTS sperrt und welche nicht, steht bei `einreihenJeMonat()` — daran
 * haengt, ob die Momentaufnahmen je wieder aufgefrischt werden.
 */
export async function ladenakteNachfuellen(heute: string): Promise<number> {
  let n = 0

  n += await belegzaehlungEinreihen(heute)

  /*
   * 2. BWA-Historie und Stammdatenblatt: je Betrieb einer im Kalendermonat.
   *    Beides sind Momentaufnahmen, die LINA ueberschreibt.
   *
   *    DER MONATSTAKT HAENGT AM ZEITRAUM DES POSTENS, NICHT AN SEINEM ERGEBNIS
   *    — so wie bei den LINA-Momentaufnahmen weiter oben, aus demselben Grund.
   *
   *    Die erste Fassung fragte `sync.aufgabe` nach `status = 'ok'`. Damit fiel
   *    jeder Posten durchs Netz, der mit `keine_daten` endete: er galt als
   *    „diesen Monat noch nicht geholt" und wurde in JEDER Nacht neu
   *    eingereiht — 365 Aufrufe im Jahr statt zwoelf, und in der Statistik sah
   *    es aus wie eine monatliche Momentaufnahme. Ein Zeitraum kennt dieses
   *    Problem nicht, weil er nichts ueber den Ausgang weiss. Er deckt
   *    ausserdem den Fall mit ab, dass ein Posten den ganzen Monat lang
   *    scheitert: der naechste Monat bringt eine frische Zeile, auch wenn die
   *    alte auf 'aufgegeben' steht.
   *
   *    Nebenbei entfaellt eine Abfrage je Betrieb und Endpunkt — 262 Rundreisen
   *    zur Datenbank in jedem Lauf, nur um festzustellen, dass nichts zu tun ist.
   */
  const betriebe = await query<{ lina_betrieb_id: number }>(
    `SELECT b.lina_betrieb_id
       FROM core.betrieb b
      WHERE b.lina_betrieb_id IS NOT NULL
      ORDER BY b.lina_betrieb_id`)

  const monatsErster = `${heute.slice(0, 7)}-01`
  for (const key of ['la:bwa_longterm', 'la:stammdaten'] as const) {
    for (const z of betriebe) {
      n += await einreihenJeMonat(key, monatsErster, PRIORITAET_LADENAKTE,
        { linaBetriebId: String(z.lina_betrieb_id) })
    }
  }

  return n
}

/**
 * Hinter der Historie (90), vor der Nacharbeit. Die Ladenakte ist wertvoll,
 * aber nichts davon ist tagesaktuell — die Tagesdaten haben Vorrang.
 */
const PRIORITAET_LADENAKTE = 95

/**
 * Die Zaehlung des Belegarchivs — gestaffelt nach dem, was sie je gefunden hat.
 *
 * DER GESTAFFELTE TAKT (01.09.2026, Entscheidung in docs/entscheidungen.md).
 * Bis dahin lief je Betrieb und Belegart JEDE Nacht eine Zaehlung: 1.974
 * Aufrufe, 6,68 von 7,18 Stunden des Laufs 109 — fuer 1,37 % veraenderte
 * Staende. 846 der 1.974 gehoeren zu den sechs Belegarten mit
 * `inhalt_holen = false`, fuer die `laLaden()` nachweislich NIE einen Abzug
 * nachreiht: 2 h 52 je Nacht ohne jeden Folgeschritt. Jetzt gilt:
 *
 *   taeglich      freigegebene Paare (`inhalt_holen`), die eine der vier
 *                 Fragen bejahen: nie gezaehlt? Historie juenger als 14
 *                 Tage (Bootstrap fuer neue Betriebe/Ordner)? Bewegung in
 *                 14 Tagen (mehr als ein Zaehlstand)? juengste Zaehlung
 *                 weicht vom gehaltenen Bestand ab (ein liegengebliebener
 *                 Abzug darf nicht bis zum Bucket-Tag warten)?
 *   woechentlich  die uebrigen freigegebenen — am Wochentags-Bucket ihres
 *                 BETRIEBS (`lina_betrieb_id % 7`), plus ein Auffangnetz
 *                 nach 8 Tagen, das einen verpassten Bucket-Tag am
 *                 Folgetag repariert.
 *   monatlich     die nie geladenen Belegarten — am Monatstags-Bucket des
 *                 Betriebs (`% 28`, verteilt statt 846 am Monatsersten),
 *                 Auffangnetz nach 32 Tagen.
 *
 * Der Preis, ehrlich genannt: ein Ordner, der lange still war und ploetzlich
 * Belege bekommt, wird erst am Bucket-Tag bemerkt — bis zu 7 Tage, nach einer
 * Abbruchnacht bis zu 8. Fuer Buchhaltungsbelege, die beim Eintreffen Wochen
 * alt sind, ist das entschieden vertretbar. Die Pruefzeile in
 * `mart.pruefung_uebersicht` misst seit 0099 gegen genau diese Takte
 * (10 bzw. 36 Tage).
 *
 * BUCKET JE BETRIEB, NICHT JE PAAR: sonst verstreuten sich die 14 Ordner
 * eines Betriebs ueber die Woche, und der storeId-Token (90 s Cache je
 * Betrieb) wuerde je Tag statt je Woche neu aufgeloest — dasselbe Argument
 * wie beim ORDER BY unten.
 *
 * DER TAKT HAENGT DAMIT TEILS AN DER MESSUNG, nicht mehr nur am Zeitraum —
 * mit offenen Augen, denn die Lehre aus dem Fehlerkatalog (ein Takt am
 * Ergebniswert kennt immer einen vergessenen Ausgang) hat hier zwei Waechter:
 * der Fall `keine_daten` (Betrieb ohne Belegarchiv, es entsteht nie eine
 * Bestandszeile) zaehlt ausdruecklich wie eine Messung, sonst liefe er ewig
 * taeglich; und ein Paar, dessen Zaehlung SCHEITERT, bleibt faellig — das ist
 * gewollt, ein Fehler soll wiederkommen, bis er beantwortet ist.
 *
 * WAS HIER ERSETZT WURDE UND WARUM. Bis zum 13.08.2026 stand an dieser Stelle
 * eine Abfrage gegen `manual.belegarchiv_soll` — die Handzaehlung vom
 * 11.08.2026, die kein Code je fortgeschrieben hat. Sie reihte einen Ordner
 * genau so lange ein, bis es fuer ihn einen Bestandssatz mit `records_total >
 * 0` gab. Das ist die Bedingung eines EINMALIGEN Abzugs, nicht die eines
 * laufenden Abgleichs: am 12.08.2026 um 13:25 war der Abzug fertig, und
 * seither lieferte sie null Zeilen. Nachgemessen am 13.08.2026 in Produktion —
 * die Laeufe 85 bis 88 hatten je NULL `la:*`-Aufgaben, alle 621 Posten standen
 * auf "ok", und `core.buchungsbeleg` bekam zwei Tage lang keinen einzigen
 * Beleg mehr, bei einem Mittel von 331 am Tag. Der Lauf meldete durchgaengig
 * "ok". Ein Importer ohne Arbeit sieht genauso aus wie einer, der fertig ist.
 *
 * DER TORWAECHTER IST JETZT DIE MESSUNG SELBST, keine eingefrorene Liste. Jede
 * Zaehlung entscheidet in `laLaden()`, ob ein Abzug folgt (Vergleich
 * `records_total` gegen `count(*)` in `core.buchungsbeleg`). Damit ist
 * `manual.belegarchiv_soll` kein Tor mehr, sondern nur noch die historische
 * Zaehlung vom 11.08.2026 — sie bleibt stehen, weil `mart.belegarchiv_fehlend`
 * sie als dritte Zahl neben Bestand und Ist fuehrt.
 *
 * NEUE BETRIEBE UND ORDNER KOMMEN VON SELBST DAZU: die Menge entsteht als
 * Kreuzprodukt aus `core.betrieb` und `core.belegart`, beide live gelesen.
 * Zehn Betriebe hatten am 13.08.2026 keine Soll-Zeile und waren damit
 * unerreichbar — heute keiner davon operativ, aber ein neu eroeffneter
 * Betrieb waere denselben Weg gegangen und ebenso stumm herausgefallen.
 *
 * EINE EINZIGE ABFRAGE statt 1.834 Rundreisen. Migration 0059 hat vorgefuehrt,
 * was 262 Einzelpruefungen kosten: sieben Minuten Nachfuellzeit. Das
 * Kreuzprodukt ist siebenmal so gross — als Schleife waere es die Rueckkehr
 * desselben Fehlers. Der Index aus 0059 (`endpunkt, zeitraum_von`) traegt das
 * NOT EXISTS.
 *
 * EIN POSTEN JE PAAR UND TAG, gleich wie er ausgeht: das tagesweise
 * NOT EXISTS unten bleibt — mehrere Laeufe am selben Tag reihen nichts
 * doppelt ein.
 *
 * ORDER BY lina_betrieb_id: der `storeId`-Token gilt je BETRIEB und haelt
 * gemessene 172 s (`src/ladenakte/token.ts`). Werden die Ordner eines Betriebs
 * nacheinander abgearbeitet, kostet er zwei Zusatzaufrufe je Betrieb statt
 * zwei je Ordner. `posten_holen()` sortiert bei gleicher Prioritaet nach
 * `posten_id`, also nach Einreihreihenfolge.
 */
async function belegzaehlungEinreihen(heute: string): Promise<number> {
  const r = await query<{ posten_id: number }>(
    `INSERT INTO sync.warteschlange
       (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
     SELECT 'la:belegzahl', $1::date, $1::date, $2, p.parameter
       FROM (SELECT jsonb_build_object(
                      'linaBetriebId', b.lina_betrieb_id::text,
                      'typeId',        a.typ_id) AS parameter
               FROM core.betrieb b
               CROSS JOIN core.belegart a
               -- Alles, was die Zaehlung dieses Paares je ergeben hat.
               -- quelle = 'zaehlung', sonst verfaelschen Abzugszeilen die
               -- Bewegungs- und Standfragen. Die Fenster ankern an $1
               -- (Geschaeftstag), nicht an now() — die Tests rechnen mit
               -- festen Tagen.
               LEFT JOIN LATERAL (
                 SELECT max(z.gemessen_am)  AS juengste,
                        min(z.gemessen_am)  AS aelteste,
                        count(DISTINCT z.records_total)
                          FILTER (WHERE z.gemessen_am >= $1::date - interval '14 days')
                                            AS stufen14,
                        (array_agg(z.records_total ORDER BY z.gemessen_am DESC))[1]
                                            AS letzter_stand
                   FROM core.belegarchiv_bestand z
                  WHERE z.betrieb_key = b.betrieb_key AND z.typ_id = a.typ_id
                    AND z.quelle = 'zaehlung') z ON true
               -- Der gehaltene Bestand — dieselbe Zahl, gegen die laLaden()
               -- nach jeder Zaehlung den Abzug entscheidet.
               LEFT JOIN LATERAL (
                 SELECT count(*) AS n FROM core.buchungsbeleg d
                  WHERE d.betrieb_key = b.betrieb_key AND d.typ_id = a.typ_id) g ON true
               -- "Kein Belegarchiv" ist eine Antwort, keine fehlende Messung:
               -- solche Betriebe bekommen nie eine Bestandszeile und liefen
               -- sonst ueber den Nie-gezaehlt-Zweig ewig taeglich. Eine
               -- keine_daten-Aufgabe der letzten 14 Tage zaehlt wie eine
               -- Messung; der Wochen-Bucket bleibt als Sonde.
               LEFT JOIN (SELECT DISTINCT k.parameter->>'linaBetriebId' AS lb
                            FROM sync.aufgabe k
                           WHERE k.endpunkt = 'la:belegzahl'
                             AND k.status = 'keine_daten'
                             AND k.beendet_am >= $1::date - interval '14 days') kd
                      ON kd.lb = b.lina_betrieb_id::text
              WHERE b.lina_betrieb_id IS NOT NULL
                -- Der Lohn-Zweig steht gar nicht erst in core.belegart
                -- (Migration 0053, Falle 1). Die Bedingung ist der zweite
                -- Guertel: wer dort je eine Zeile ergaenzt, holt damit nicht
                -- versehentlich Ausweisdokumente und Krankmeldungen.
                AND a.zweig = 'fibu'
                AND CASE WHEN a.inhalt_holen THEN
                         -- taeglich, wenn eine der vier Fragen offen ist:
                            (z.juengste IS NULL AND kd.lb IS NULL)
                         OR z.aelteste >= $1::date - interval '14 days'
                         OR z.stufen14 > 1
                         OR (z.juengste IS NOT NULL
                             AND z.letzter_stand IS DISTINCT FROM g.n)
                         -- Auffangnetz: repariert einen verpassten Bucket-Tag
                         -- am Folgetag, nicht erst eine Woche spaeter.
                         OR z.juengste < $1::date - interval '8 days'
                         -- sonst woechentlich, am Bucket-Tag des Betriebs:
                         OR b.lina_betrieb_id % 7 = extract(dow from $1::date)::int
                    ELSE
                         -- nie geladene Belegarten: monatlich reicht — es
                         -- folgt kein Abzug, nur die Bestandszahl.
                            b.lina_betrieb_id % 28 = extract(day from $1::date)::int - 1
                         OR (z.juengste IS NULL AND kd.lb IS NULL)
                         OR z.juengste < $1::date - interval '32 days'
                    END
              ORDER BY b.lina_betrieb_id, a.typ_id) p
      WHERE NOT EXISTS (SELECT 1 FROM sync.warteschlange w
                         WHERE w.endpunkt = 'la:belegzahl'
                           AND w.zeitraum_von = $1::date
                           AND w.parameter = p.parameter)
     RETURNING posten_id`,
    [heute, PRIORITAET_LADENAKTE])
  return r.length
}

/*
 * HIER STAND `einreihenWennNeu()` — entfernt am 13.08.2026 mit dem Umbau auf
 * die taegliche Zaehlung.
 *
 * Sie war das Einreihen fuer den EINMALIGEN Abzug des Belegarchivs und sperrte
 * zwei Zustaende: offen (kommt ohnehin dran) und 'aufgegeben' (sonst waechst
 * die Warteschlange jede Nacht um denselben kaputten Posten). Ihr einziger
 * Aufrufer war der Belegordner-Zweig oben, und der entscheidet jetzt nicht
 * mehr hier, sondern in `laLaden()` an einer gemessenen Abweichung.
 *
 * Die Lehre bleibt und steht in docs/fehlerkatalog.md (12.08.2026, zwei
 * Eintraege): ein Wiederholtakt gehoert an den ZEITRAUM, nicht an einen
 * Ergebniswert. Erst sperrte diese Funktion jede erledigte Zeile fuer immer,
 * wodurch die Momentaufnahmen ab September wortlos ausgeblieben waeren; dann
 * liess die Lockerung Posten mit 'keine_daten' jede Nacht durch. Beides
 * Symptome derselben Verwechslung. `einreihenJeMonat()` gleich darunter macht
 * es richtig, `belegzaehlungEinreihen()` weiter oben ebenso — beide haengen
 * am Zeitraum.
 */

/**
 * Einreihen fuer eine MONATLICHE Momentaufnahme — BWA-Historie, Stammdatenblatt.
 *
 * Ein Posten je Betrieb und Kalendermonat, und der Takt haengt ausschliesslich am
 * Zeitraum: gibt es fuer diesen Monat schon eine Zeile — offen, erledigt,
 * gescheitert, aufgegeben, gleich welche —, passiert nichts. Im naechsten Monat
 * gibt es eine frische.
 *
 * Das ist derselbe Bau wie bei den LINA-Momentaufnahmen weiter oben, und aus
 * demselben Grund: ein Wiederholtakt, der an einem Ergebniswert haengt, kennt
 * immer einen Ausgang, an den niemand gedacht hat. Hier waren es 'keine_daten'
 * und 'aufgegeben'.
 *
 * Verglichen wird ueber `date_trunc('month', …)` und nicht auf Gleichheit mit dem
 * Monatsersten. Der erste Lauf am 12.08.2026 hat seine Posten noch mit dem
 * Tagesdatum eingereiht; ohne diesen Vergleich bekaeme jeder der 131 Betriebe im
 * August eine zweite Zeile — 262 Anfragen an LINA fuer Daten, die schon da sind.
 */
async function einreihenJeMonat(
  endpunkt: string, monatsErster: string, prioritaet: number, parameter: Record<string, string>,
): Promise<number> {
  const r = await query<{ posten_id: number }>(
    `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
     SELECT $1, $2::date, $2::date, $3, $4::jsonb
      WHERE NOT EXISTS (
            SELECT 1 FROM sync.warteschlange w
             WHERE w.endpunkt = $1 AND w.parameter = $4::jsonb
               -- ALS BEREICH UND NICHT ALS date_trunc AUF DER SPALTE.
               -- Fachlich dasselbe, aber date_trunc(spalte) ist nicht
               -- indexfaehig: gemessen am 12.08.2026 ein Parallel Seq Scan
               -- ueber alle 168.218 Zeilen, 27 ms je Pruefung. Das
               -- Nachfuellen brauchte dadurch sieben Minuten, in denen es
               -- 237 Posten einreihte — und wurde mit jedem Lauf langsamer,
               -- weil die Tabelle nur waechst (17 offen, der Rest Historie).
               -- Der Index dazu steht in Migration 0059.
               AND w.zeitraum_von >= date_trunc('month', $2::date)::date
               AND w.zeitraum_von <  (date_trunc('month', $2::date)
                                       + interval '1 month')::date)
     RETURNING posten_id`,
    [endpunkt, monatsErster, prioritaet, JSON.stringify(parameter)])
  return r.length
}

/**
 * Aufgegebene Posten zurueck in die Warteschlange holen — begrenzt.
 *
 * DAS PROBLEM. `ergebnis = 'aufgegeben'` setzt `erledigt_am`. Der Posten gilt
 * damit als erledigt, und bis zum 13.08.2026 sah ihn KEIN Code je wieder an.
 * In Produktion lagen so 275 `fn:bestellpositionen` still — alle HTTP 500,
 * alle vier Versuche, alle aus dem Backfill vom 02. bis 04.08.2026. Folge:
 * 322 Bestellungen ueber 686.535,93 EUR mit Kopf und ohne eine einzige
 * Position, die in `mart.einkauf_beleg` voll mitzaehlen.
 *
 * WARUM BEGRENZT UND NICHT EINFACH IMMER WIEDER. Ohne Obergrenze waere das
 * derselbe Bau wie der 403-Zweig in `src/sync/worker.ts`: dort zaehlt
 * `posten_holen()` die Versuche hoch und der Zweig wieder herunter, netto ±0,
 * seit neun Tagen. Ein Posten, der wirklich nicht holbar ist, wuerde jede
 * Nacht vier Aufrufe kosten und nie zur Ruhe kommen. `wiederbelebt` zaehlt
 * mit; nach `MAX_WIEDERBELEBUNGEN` ist Schluss, und dann steht der Posten
 * sichtbar in `mart.posten_aufgegeben` als endgueltig.
 *
 * NUR WENN DIE QUELLE GERADE NACHWEISLICH ANTWORTET. Ohne diese Bedingung
 * verbraeuchte ein zweitaegiger Ausfall der Gegenstelle alle Wiederbelebungen
 * aller Posten, und danach waere der Vorrat aufgebraucht — ausgerechnet dann,
 * wenn die Quelle wieder da ist. Gefordert wird deshalb mindestens EIN 'ok'
 * desselben Endpunkts in den letzten 24 Stunden.
 *
 * FRUEHESTENS NACH 20 STUNDEN, damit ein Posten nicht zweimal am selben Tag
 * wiederbelebt wird, wenn der Sync mehrmals laeuft (am 12.08.2026 waren es
 * fuenf Laeufe). 20 statt 24: der Zeitplan steht auf 05:02, und zwei Laeufe
 * an aufeinanderfolgenden Tagen liegen nie exakt 24 Stunden auseinander.
 */
export async function aufgegebeneWiederbeleben(): Promise<number> {
  /**
   * HOECHSTENS `WIEDERBELEBUNGEN_JE_LAUF` AUF EINMAL (01.09.2026).
   *
   * Wiederbelebte Posten tragen die aeltesten Daten und laufen darum
   * (`zeitraum_von DESC` in `posten_holen()`) zwangslaeufig hintereinander
   * am Ende der Spur. Zehn davon, alle deterministisch kaputt, trafen in
   * den Laeufen 108–110 exakt ABBRUCH_NACH_FEHLERN — drei Naechte in Folge
   * brach die FoodNotify-Spur an ihrer eigenen Wiederbelebung ab. Die
   * Obergrenze haelt eine volle Runde strukturell unter der Notbremse
   * (Kreuzpruefung in config.ts); was ein Lauf nicht zurueckholt, holt der
   * naechste — die aeltesten zuerst.
   *
   * FOR UPDATE SKIP LOCKED, WEIL DER VORLAUF NICHT ALLEIN IST. `nachfuellen()`
   * laeuft VOR der Laufsperre (`sperreHolen()` kommt erst in `workerLauf()`);
   * am 12.08.2026 liefen fuenf Laeufe an einem Tag. Zwei gleichzeitige
   * Vorlaeufe wuerden dieselben Posten waehlen und `wiederbelebt` doppelt
   * abbuchen — SKIP LOCKED laesst den zweiten die Zeilen des ersten
   * ueberspringen, und das aeussere `ergebnis = 'aufgegeben'` prueft nach
   * dem Sperren erneut, was der Planner beim Nachlesen sonst uebernaehme.
   */
  const r = await query<{ endpunkt: string }>(
    `UPDATE sync.warteschlange w
        SET erledigt_am = NULL, ergebnis = NULL, versuche = 0,
            in_arbeit_seit = NULL, faellig_ab = now(),
            wiederbelebt = w.wiederbelebt + 1
      WHERE w.posten_id IN (
            SELECT k.posten_id
              FROM sync.warteschlange k
             WHERE k.ergebnis = 'aufgegeben'
               AND k.wiederbelebt < $1
               AND k.erledigt_am < now() - interval '20 hours'
               -- Die Quelle muss gerade antworten, sonst ist der Versuch verschenkt.
               AND EXISTS (SELECT 1 FROM sync.aufgabe a
                            WHERE a.endpunkt = k.endpunkt AND a.status = 'ok'
                              AND a.beendet_am > now() - interval '24 hours')
               -- Der Eindeutigkeitsindex ist partiell (WHERE erledigt_am IS NULL).
               -- Steht fuer dieselbe Arbeit schon ein offener Posten, wuerde das
               -- Wiederbeleben ihn verletzen — dann ist ohnehin nichts zu tun.
               AND NOT EXISTS (
                   SELECT 1 FROM sync.warteschlange o
                    WHERE o.erledigt_am IS NULL
                      AND o.endpunkt = k.endpunkt
                      AND coalesce(o.betrieb_enc_id, '') = coalesce(k.betrieb_enc_id, '')
                      AND coalesce(o.marke_key, 0) = coalesce(k.marke_key, 0)
                      AND o.zeitraum_von = k.zeitraum_von AND o.zeitraum_bis = k.zeitraum_bis
                      AND coalesce(o.parameter::text, '{}') = coalesce(k.parameter::text, '{}'))
             ORDER BY k.erledigt_am, k.posten_id
             LIMIT $2
               FOR UPDATE SKIP LOCKED)
        AND w.ergebnis = 'aufgegeben'
     RETURNING w.endpunkt`,
    [config.MAX_WIEDERBELEBUNGEN, config.WIEDERBELEBUNGEN_JE_LAUF])

  if (r.length > 0) {
    const jeEndpunkt: Record<string, number> = {}
    for (const z of r) jeEndpunkt[z.endpunkt] = (jeEndpunkt[z.endpunkt] ?? 0) + 1
    /**
     * Nur wenn die Obergrenze voll ausgeschoepft wurde, kann etwas
     * zurueckgeblieben sein — dann steht die Zahl daneben, damit „3
     * wiederbelebt" nicht wie „alle" liest. Die Zaehlung ist bewusst eine
     * zweite, ungesperrte Abfrage: fuers Log reicht ungefaehr, und eine
     * exakte Zahl waere den Sperraufwand nicht wert.
     */
    let zurueckgestellt = 0
    if (r.length >= config.WIEDERBELEBUNGEN_JE_LAUF) {
      const z = await eine<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM sync.warteschlange k
          WHERE k.ergebnis = 'aufgegeben'
            AND k.wiederbelebt < $1
            AND k.erledigt_am < now() - interval '20 hours'`,
        [config.MAX_WIEDERBELEBUNGEN])
      zurueckgestellt = Number(z?.n ?? 0)
    }
    log.info('aufgegebene posten wiederbelebt', { posten: r.length, jeEndpunkt, zurueckgestellt })
  }
  return r.length
}

export async function nachfuellen(): Promise<NachfuellStand> {
  /**
   * ZUERST DER WÄCHTER, UND AUSDRÜCKLICH OHNE `try`.
   *
   * Alles darunter fängt seine Fehler ab, weil ein Fehler beim Nachfüllen den
   * Lauf nicht verhindern soll — die Warteschlange enthält in aller Regel noch
   * Arbeit. Hier ist es umgekehrt: ein Endpunkt ohne Einreihzweig, ohne
   * Dispatch-Fall oder ohne Producer für seinen Schlüssel liefert genau NULL
   * Arbeit und meldet dabei „ok". Ein Lauf, der so etwas verschweigt, ist
   * schlimmer als ein Lauf, der abbricht: der Abbruch steht in
   * `mart.sync_status` und in `/status`, die stille Lücke nirgends.
   *
   * Der Fehler ist ausserdem deterministisch — er hängt am Code, nicht an der
   * Gegenstelle. Er tritt beim ersten Lauf nach dem Deploy auf oder nie.
   */
  endpunkteZusichern()

  /**
   * Und direkt danach das Quellenregister spiegeln (Migration `0076`).
   *
   * Es steht hier und nicht am Ende, weil `mart.quelle_zulauf` sonst bis nach
   * dem ersten Lauf leer wäre — und eine leere Wächtersicht ist genau der
   * Zustand, gegen den sie gebaut ist. Wirft nie, siehe `sync/quellen.ts`.
   */
  await quellenSpiegeln()

  const stand: NachfuellStand = { lina: 0, foodnotify: 0, ladenakte: 0, wiederbelebt: 0, nulltage: 0, nachlese: 0, lochtage: 0, betriebsberichte: 0 }

  try {
    stand.lina = await linaNachfuellen()
  } catch (e) {
    log.error('nachfüllen lina gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  try {
    stand.nulltage = await nulltageNachziehen()
  } catch (e) {
    log.error('nulltage nachziehen gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  try {
    stand.lochtage = await lochtageNachziehen()
  } catch (e) {
    log.error('lochtage nachziehen gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  try {
    stand.nachlese = await nachleseNachziehen()
  } catch (e) {
    log.error('nachlese gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  try {
    stand.foodnotify = await foodnotifyNachfuellen()
  } catch (e) {
    log.error('nachfüllen foodnotify gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  try {
    stand.ladenakte = await ladenakteNachfuellen(geschaeftstag(new Date()))
  } catch (e) {
    log.error('nachfüllen ladenakte gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  try {
    stand.betriebsberichte = await betriebsberichteNachfuellen()
  } catch (e) {
    log.error('nachfüllen betriebsberichte gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  try {
    stand.wiederbelebt = await aufgegebeneWiederbeleben()
  } catch (e) {
    log.error('wiederbeleben gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  if (stand.lina > 0 || stand.foodnotify > 0 || stand.ladenakte > 0 || stand.wiederbelebt > 0
      || stand.nulltage > 0 || stand.nachlese > 0 || stand.lochtage > 0 || stand.betriebsberichte > 0) {
    log.info('nachgefüllt', stand)
  }
  return stand
}
