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
 * WAS HIER NICHT PASSIERT: der einmalige Historien-Backfill
 * (`einreihen --historie`, `einreihen --foodnotify`). Der wird bewusst
 * von Hand angestoßen — er stellt Zehntausende Posten ein, und das soll
 * eine Entscheidung sein, kein Nebeneffekt eines Neustarts.
 */

import { query, eine } from '../db/pool'
import { config, fnZugaenge } from '../config'
import { log } from '../lib/log'
import { AKTIVE_ENDPUNKTE, istMomentaufnahme, einreihPrioritaet } from '../lina/endpunkte'
import { geschaeftstag } from '../lib/time'
import { endpunkteZusichern } from './waechter'

export type NachfuellStand = {
  lina: number; foodnotify: number; ladenakte: number
  /** Aufgegebene Posten, die dieser Lauf zurueckgeholt hat. */
  wiederbelebt: number
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
     * Die Verschwendung ist zudem winzig: drei Endpunkte mal vier Marken
     * sind 12 Aufrufe am Tag, gegen ein FoodNotify-Tagesbudget von 140.000
     * bei rund 200 verbrauchten. Das ist der billigste Punkt dieses ganzen
     * Plans.
     *
     * Der Takt hängt weiterhin am ZEITRAUM und nicht an einem Ergebniswert —
     * gibt es für heute schon eine Zeile, passiert nichts, gleich wie sie
     * ausgegangen ist. Dieselbe Lehre wie bei `einreihenJeMonat()`.
     */
    const { fnEndpunkt } = await import('../foodnotify/endpunkte')
    for (const ep of ['fn:betriebe', 'fn:kostenstellen', 'fn:pos_standorte']) {
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

    for (const s of seiten) {
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
         JSON.stringify({ erpId: String(s.erp_id), seite: String(s.letzte_seite) })])
      n += r.length
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
          AND coalesce(b.status, '') NOT IN ('canceled', 'finished')
          -- Die Nachholtiefe aus Entscheidung 5. Aelteres bleibt liegen; das
          -- ist eine Grenze und kein Rueckstand.
          AND b.bestellt_am > now() - make_interval(months => $2::int)
          AND (
              -- der eingefrorene Altbestand: seit 0072 nicht aufgefrischt
              b.detail_geholt_am IS NULL
              -- oder das rollierende Fenster, hoechstens einmal am Tag.
              -- 20 statt 24 Stunden aus demselben Grund wie bei der
              -- Wiederbelebung: zwei Laeufe an aufeinanderfolgenden Tagen
              -- liegen nie exakt 24 Stunden auseinander.
           OR (b.bestellt_am > now() - make_interval(days => $3::int)
               AND b.detail_geholt_am < now() - interval '20 hours'))
        -- JUENGSTE ZUERST: damit deckt die Obergrenze immer erst das Fenster
        -- und dann den Altbestand. Dieselbe Entscheidung wie beim
        -- Bestell-Backfill am 02.08.2026 — aktuelle Preise vor der Historie.
        ORDER BY b.bestellt_am DESC
        LIMIT $4
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
    [markeKey, config.BESTELLDETAIL_NACHHOLTIEFE_MONATE,
     config.BESTELLDETAIL_FENSTER_TAGE, config.BESTELLDETAIL_JE_LAUF])

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
 * Die taegliche Zaehlung des Belegarchivs: je Betrieb und Belegart eine.
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
 * DER TAKT HAENGT AM ZEITRAUM, nicht an einem Ergebniswert — dieselbe Lehre
 * wie bei `einreihenJeMonat()`: gibt es fuer diesen Kalendertag schon eine
 * Zeile, passiert nichts, gleich wie sie ausgegangen ist. Morgen gibt es eine
 * frische.
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
              WHERE b.lina_betrieb_id IS NOT NULL
                -- Der Lohn-Zweig steht gar nicht erst in core.belegart
                -- (Migration 0053, Falle 1). Die Bedingung ist der zweite
                -- Guertel: wer dort je eine Zeile ergaenzt, holt damit nicht
                -- versehentlich Ausweisdokumente und Krankmeldungen.
                AND a.zweig = 'fibu'
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
  const r = await query<{ endpunkt: string }>(
    `UPDATE sync.warteschlange w
        SET erledigt_am = NULL, ergebnis = NULL, versuche = 0,
            in_arbeit_seit = NULL, faellig_ab = now(),
            wiederbelebt = w.wiederbelebt + 1
      WHERE w.ergebnis = 'aufgegeben'
        AND w.wiederbelebt < $1
        AND w.erledigt_am < now() - interval '20 hours'
        -- Die Quelle muss gerade antworten, sonst ist der Versuch verschenkt.
        AND EXISTS (SELECT 1 FROM sync.aufgabe a
                     WHERE a.endpunkt = w.endpunkt AND a.status = 'ok'
                       AND a.beendet_am > now() - interval '24 hours')
        -- Der Eindeutigkeitsindex ist partiell (WHERE erledigt_am IS NULL).
        -- Steht fuer dieselbe Arbeit schon ein offener Posten, wuerde das
        -- Wiederbeleben ihn verletzen — dann ist ohnehin nichts zu tun.
        AND NOT EXISTS (
            SELECT 1 FROM sync.warteschlange o
             WHERE o.erledigt_am IS NULL
               AND o.endpunkt = w.endpunkt
               AND coalesce(o.betrieb_enc_id, '') = coalesce(w.betrieb_enc_id, '')
               AND coalesce(o.marke_key, 0) = coalesce(w.marke_key, 0)
               AND o.zeitraum_von = w.zeitraum_von AND o.zeitraum_bis = w.zeitraum_bis
               AND coalesce(o.parameter::text, '{}') = coalesce(w.parameter::text, '{}'))
     RETURNING w.endpunkt`,
    [config.MAX_WIEDERBELEBUNGEN])

  if (r.length > 0) {
    const jeEndpunkt: Record<string, number> = {}
    for (const z of r) jeEndpunkt[z.endpunkt] = (jeEndpunkt[z.endpunkt] ?? 0) + 1
    log.info('aufgegebene posten wiederbelebt', { posten: r.length, jeEndpunkt })
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

  const stand: NachfuellStand = { lina: 0, foodnotify: 0, ladenakte: 0, wiederbelebt: 0 }

  try {
    stand.lina = await linaNachfuellen()
  } catch (e) {
    log.error('nachfüllen lina gescheitert — der Lauf geht weiter', { fehler: String(e) })
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
    stand.wiederbelebt = await aufgegebeneWiederbeleben()
  } catch (e) {
    log.error('wiederbeleben gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  if (stand.lina > 0 || stand.foodnotify > 0 || stand.ladenakte > 0 || stand.wiederbelebt > 0) {
    log.info('nachgefüllt', stand)
  }
  return stand
}
