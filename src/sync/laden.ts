/**
 * Schreibt eine geholte Antwort in die Datenbank.
 *
 * Reihenfolge in EINER Transaktion:
 *   1. raw.api_antwort  — die Versicherung. Immer, auch wenn die Struktur
 *                         nicht zum erwarteten Schema passt.
 *   2. Stammdaten       — Betriebe und Artikel, die neu aufgetaucht sind.
 *   3. core             — die Transformation.
 *
 * Eine Transaktion, damit ein Posten entweder ganz da ist oder gar nicht —
 * die Warteschlange versucht es dann erneut.
 */
import type { PoolClient } from 'pg'
import { inTransaktion, mehrzeilig, inBloecken } from '../db/pool'
import * as t from '../transform'
import type { Endpunkt } from '../lina/endpunkte'
import { log } from '../lib/log'

type Kontext = {
  ep: Endpunkt
  von: string
  bis: string
  parameter: Record<string, string>
  daten: any
  httpStatus: number
  bytes: number
  hash: string
  laufId: string
  betriebEncId: string | null
}

async function betriebeSichern(c: PoolClient, betriebe: { encId: string; name: string }[]) {
  const map = new Map<string, number>()
  if (betriebe.length === 0) return map
  const eindeutig = [...new Map(betriebe.map(b => [b.encId, b])).values()]

  await inBloecken(eindeutig, 500, async block => {
    const { platzhalter, werte } = mehrzeilig(
      ['enc_id', 'name'], block.map(b => ({ enc_id: b.encId, name: b.name })))
    await c.query(
      `INSERT INTO core.betrieb (enc_id, name) VALUES ${platzhalter}
       ON CONFLICT (enc_id) DO UPDATE SET name = EXCLUDED.name, zuletzt_am = now()`, werte)
  })

  const r = await c.query(
    `SELECT betrieb_key, enc_id FROM core.betrieb WHERE enc_id = ANY($1)`,
    [eindeutig.map(b => b.encId)])
  for (const z of r.rows) map.set(z.enc_id, Number(z.betrieb_key))
  return map
}

/**
 * Schreibt den Artikelstand des Monats fort — aber nur, wenn sich gegenüber
 * dem letzten bekannten Stand etwas geändert hat.
 *
 * `core.artikel` hält den aktuellen Stand und überschreibt dabei `fixer_we`.
 * Das ist für Joins richtig und für jede Rückrechnung falsch: der hinterlegte
 * Wareneinsatz ändert sich mit jeder Rezeptur- und Einkaufspreisanpassung.
 * Ohne diese Historie würde der theoretische Wareneinsatz für Juni 2023 mit
 * der heutigen Kalkulation gerechnet — plausibel aussehend und still falsch.
 */
async function artikelStandFortschreiben(
  c: PoolClient, stamm: t.ArtikelStamm[], monat: string, keys: Map<number, number>,
) {
  const zeilen = stamm
    .filter(a => keys.has(a.artikelnummer))
    .map(a => ({ artikel_key: keys.get(a.artikelnummer)!, name: a.name, fixer_we: a.fixerWe }))
  if (zeilen.length === 0) return

  // unnest statt einer VALUES-Liste: in einem Unterabfrage-VALUES ohne
  // explizite Typen hält Postgres die Parameter für text, und der Join auf
  // artikel_key (integer) schlägt fehl. Mit typisierten Arrays ist es
  // eindeutig — und die Blockaufteilung entfällt gleich mit.
  await c.query(
    `INSERT INTO core.artikel_stand (artikel_key, monat, name, fixer_we)
     SELECT v.artikel_key, date_trunc('month', $4::date)::date, v.name, v.fixer_we
       FROM unnest($1::int[], $2::text[], $3::numeric[])
            AS v(artikel_key, name, fixer_we)
       LEFT JOIN LATERAL (
           SELECT s.name, s.fixer_we
             FROM core.artikel_stand s
            WHERE s.artikel_key = v.artikel_key
              AND s.monat <= date_trunc('month', $4::date)::date
            ORDER BY s.monat DESC LIMIT 1
       ) letzt ON true
      WHERE letzt.name IS NULL
         OR letzt.name IS DISTINCT FROM v.name
         OR letzt.fixer_we IS DISTINCT FROM v.fixer_we
     ON CONFLICT (artikel_key, monat) DO NOTHING`,
    [zeilen.map(z => z.artikel_key), zeilen.map(z => z.name), zeilen.map(z => z.fixer_we), monat])
}

/**
 * lina_id -> Primärschlüssel für die Stammdatentabellen.
 *
 * Einheiten, Lieferanten und Waren kommen als getrennte Posten und in
 * beliebiger Reihenfolge an. Wer noch nicht da ist, fehlt in der Map, und der
 * Verweis bleibt null — die Fremdschlüssel sind bewusst nullable. Besser ein
 * Satz ohne Verweis als ein gescheiterter Posten, der 20 Minuten später
 * erneut gegen LINA läuft.
 */
async function schluesselMap(c: PoolClient, tabelle: string, keySpalte: string) {
  const r = await c.query(`SELECT ${keySpalte} AS k, lina_id FROM ${tabelle}`)
  return new Map<number, number>(r.rows.map(z => [Number(z.lina_id), Number(z.k)]))
}

async function artikelSichern(c: PoolClient, stamm: t.ArtikelStamm[]) {
  const map = new Map<number, number>()
  if (stamm.length === 0) return map
  const eindeutig = [...new Map(stamm.map(a => [a.artikelnummer, a])).values()]

  await inBloecken(eindeutig, 500, async block => {
    const { platzhalter, werte } = mehrzeilig(
      ['artikelnummer', 'name', 'fixer_we'],
      block.map(a => ({ artikelnummer: a.artikelnummer, name: a.name, fixer_we: a.fixerWe })))
    await c.query(
      `INSERT INTO core.artikel (artikelnummer, name, fixer_we) VALUES ${platzhalter}
       ON CONFLICT (artikelnummer) DO UPDATE SET
         name = EXCLUDED.name,
         fixer_we = COALESCE(EXCLUDED.fixer_we, core.artikel.fixer_we),
         zuletzt_am = now()`, werte)
  })

  const r = await c.query(
    `SELECT artikel_key, artikelnummer FROM core.artikel WHERE artikelnummer = ANY($1)`,
    [eindeutig.map(a => a.artikelnummer)])
  for (const z of r.rows) map.set(Number(z.artikelnummer), Number(z.artikel_key))
  return map
}

export async function laden(k: Kontext): Promise<number> {
  return inTransaktion(async c => {
    // Partitionen bei Bedarf — kein Wartungsjob, den man vergessen kann.
    // Der Raw-Layer ist nach ABRUFZEITPUNKT partitioniert, also nach heute;
    // `current_date + 1` deckt den Fall ab, dass der Monat zwischen diesem
    // Aufruf und dem INSERT umspringt.
    await c.query(
      `SELECT core.partition_anlegen('raw.api_antwort', d)
         FROM unnest(ARRAY[current_date, current_date + 1]) AS d`)

    const roh = await c.query(
      `INSERT INTO raw.api_antwort
         (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, parameter,
          http_status, payload, payload_hash, payload_bytes, lauf_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, abgerufen_am`,
      [k.ep.key, k.betriebEncId, k.von, k.bis, JSON.stringify(k.parameter),
       k.httpStatus, JSON.stringify(k.daten), k.hash, k.bytes, k.laufId])
    const rawId = String(roh.rows[0].id)
    const abgerufenAm = roh.rows[0].abgerufen_am

    await c.query(`SELECT core.partition_anlegen('core.artikelverkauf_tag', $1::date)`, [k.von])

    const keys = await betriebeSichern(c, t.betriebeAus(k.daten))
    const bk = (enc: string) => keys.get(enc)
    let geschrieben = 0

    switch (k.ep.key) {
      case 'getUmsatzbericht':
      case 'getUmsatzbericht:speisen':
      case 'getUmsatzbericht:getraenke': {
        const posId = k.parameter.hauptsparten ? Number(k.parameter.hauptsparten) : null
        let hsKey: number | null = null
        if (posId !== null) {
          const r = await c.query(`SELECT hauptsparte_key FROM core.hauptsparte WHERE pos_id = $1`, [posId])
          hsKey = r.rows[0] ? Number(r.rows[0].hauptsparte_key) : null
        }
        const spalten = ['betrieb_key','geschaeftstag','hauptsparte_key','verkaufsstelle_key',
                         'umsatz_netto','umsatz_brutto','rechnungen','gaeste',
                         'durchschnittsbon','umsatz_pro_gast','raw_id'] as const
        const roh = t.umsatzbericht(k.daten, k.von, posId)

        // Anzahlen, die keine sein können (siehe transform/index.ts,
        // `anzahl`). Sie wurden auf null gesetzt — hier bekommen sie einen
        // Platz, an dem jemand sie wiederfindet. Der Posten gilt trotzdem
        // als erledigt: der Umsatz des Tages ist in Ordnung.
        const verworfen = roh.flatMap(z => (z.verworfen ?? []).map(v => ({ ...v, encId: z.encId })))
        if (verworfen.length) {
          log.warn('unplausible Anzahl verworfen', {
            endpunkt: k.ep.key, tag: k.von, anzahl: verworfen.length,
            beispiel: verworfen[0],
          })
          await c.query(
            `INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich)
             VALUES ($1, $2, $3)`,
            [k.ep.key,
             JSON.stringify({ hinweis: 'bills/guests sind Anzahlen im int4-Bereich' }),
             JSON.stringify({ geschaeftstag: k.von, raw_id: rawId, verworfen })])
        }

        const zeilen = roh
          .filter(z => bk(z.encId))
          .map(z => ({
            betrieb_key: bk(z.encId)!, geschaeftstag: z.geschaeftstag,
            hauptsparte_key: hsKey, verkaufsstelle_key: null,
            umsatz_netto: z.umsatzNetto, umsatz_brutto: z.umsatzBrutto,
            rechnungen: z.rechnungen, gaeste: z.gaeste,
            durchschnittsbon: z.durchschnittsbon, umsatz_pro_gast: z.umsatzProGast,
            raw_id: rawId,
          }))
        await inBloecken(zeilen, 500, async b => {
          const { platzhalter, werte } = mehrzeilig(spalten, b)
          await c.query(
            `INSERT INTO core.umsatzbericht_tag (${spalten.join(',')}) VALUES ${platzhalter}
             ON CONFLICT ON CONSTRAINT umsatzbericht_tag_uq DO UPDATE SET
               umsatz_netto = EXCLUDED.umsatz_netto, umsatz_brutto = EXCLUDED.umsatz_brutto,
               rechnungen = EXCLUDED.rechnungen, gaeste = EXCLUDED.gaeste,
               durchschnittsbon = EXCLUDED.durchschnittsbon,
               umsatz_pro_gast = EXCLUDED.umsatz_pro_gast,
               raw_id = EXCLUDED.raw_id, geladen_am = now()`, werte)
        })
        geschrieben = zeilen.length
        break
      }

      case 'getPersonalkosten': {
        const { kosten, schwellen } = t.personalkosten(k.daten, k.von, k.bis)
        const sK = ['betrieb_key','zeitraum_von','zeitraum_bis','eff_service','eff_bar','eff_kueche',
                    'eff_gesamt','pek_service','pek_bar','pek_kueche','pek_gesamt','persoog_bwa','raw_id'] as const
        const kz = kosten.filter(z => bk(z.encId)).map(z => ({
          betrieb_key: bk(z.encId)!, zeitraum_von: z.zeitraumVon, zeitraum_bis: z.zeitraumBis,
          eff_service: z.effService, eff_bar: z.effBar, eff_kueche: z.effKueche, eff_gesamt: z.effGesamt,
          pek_service: z.pekService, pek_bar: z.pekBar, pek_kueche: z.pekKueche, pek_gesamt: z.pekGesamt,
          persoog_bwa: z.persoogBwa, raw_id: rawId,
        }))
        await inBloecken(kz, 500, async b => {
          const { platzhalter, werte } = mehrzeilig(sK, b)
          await c.query(
            `INSERT INTO core.personalkosten (${sK.join(',')}) VALUES ${platzhalter}
             ON CONFLICT (betrieb_key, zeitraum_von, zeitraum_bis) DO UPDATE SET
               eff_service = EXCLUDED.eff_service, eff_bar = EXCLUDED.eff_bar,
               eff_kueche = EXCLUDED.eff_kueche, eff_gesamt = EXCLUDED.eff_gesamt,
               pek_service = EXCLUDED.pek_service, pek_bar = EXCLUDED.pek_bar,
               pek_kueche = EXCLUDED.pek_kueche, pek_gesamt = EXCLUDED.pek_gesamt,
               persoog_bwa = EXCLUDED.persoog_bwa, raw_id = EXCLUDED.raw_id, geladen_am = now()`, werte)
        })

        const sS = ['betrieb_key','gueltig_ab','bereich','schwelle_gruen','schwelle_orange','schwelle_rot'] as const
        const sw = schwellen.filter(z => bk(z.encId)).map(z => ({
          betrieb_key: bk(z.encId)!, gueltig_ab: z.gueltigAb, bereich: z.bereich,
          schwelle_gruen: z.gruen, schwelle_orange: z.orange, schwelle_rot: z.rot,
        }))
        await inBloecken(sw, 500, async b => {
          const { platzhalter, werte } = mehrzeilig(sS, b)
          await c.query(
            `INSERT INTO core.schwellenwert_betrieb (${sS.join(',')}) VALUES ${platzhalter}
             ON CONFLICT (betrieb_key, gueltig_ab, bereich) DO UPDATE SET
               schwelle_gruen = EXCLUDED.schwelle_gruen,
               schwelle_orange = EXCLUDED.schwelle_orange,
               schwelle_rot = EXCLUDED.schwelle_rot, geladen_am = now()`, werte)
        })
        geschrieben = kz.length + sw.length
        break
      }

      case 'getKennzahlen:absolut':
      case 'getKennzahlen:relativ': {
        const relativ = k.ep.key.endsWith('relativ')
        const jahr = Number(k.von.slice(0, 4))
        const zeilen = t.kennzahlen(k.daten, jahr)

        const ids = [...new Set(zeilen.map(z => Number(z.linaBetriebId)))].filter(Number.isFinite)
        const map = new Map<number, number>()
        if (ids.length) {
          const r = await c.query(
            `SELECT betrieb_key, lina_betrieb_id FROM core.betrieb WHERE lina_betrieb_id = ANY($1)`, [ids])
          for (const z of r.rows) map.set(Number(z.lina_betrieb_id), Number(z.betrieb_key))
        }

        const sp = ['betrieb_key','monat','kennzahl','wert_absolut','wert_prozent','abgerufen_am','raw_id'] as const
        const rows = zeilen
          .filter(z => map.has(Number(z.linaBetriebId)))
          .map(z => ({
            betrieb_key: map.get(Number(z.linaBetriebId))!,
            monat: z.monat, kennzahl: z.kennzahl,
            wert_absolut: relativ ? null : z.wert,
            wert_prozent: relativ ? z.wert : null,
            abgerufen_am: abgerufenAm, raw_id: rawId,
          }))
        /**
         * Der Filter oben ist die Stelle, an der die BWA lautlos verschwindet.
         *
         * Wer keine `lina_betrieb_id` hat, fällt heraus — und wenn NIEMAND
         * eine hat, fällt alles heraus. Genau das ist am 26.07.2026 passiert:
         * 7.860 Zeilen weg, Posten meldet `ok`, `core.kennzahlen_monat` leer.
         * Ein Fehler, den man nur bemerkt, wenn man ihn sucht.
         *
         * Ein Abbruch wäre hier falsch: der Posten käme in Wiedervorlage und
         * liefe erneut gegen LINA, obwohl die Antwort in Ordnung ist. Die
         * Ursache liegt in `core.betrieb`, nicht in den Daten. Also nicht
         * scheitern, sondern laut sein — und sagen, was zu tun ist.
         */
        if (zeilen.length > 0 && rows.length === 0) {
          log.error(
            'keine einzige BWA-Zeile konnte einem Betrieb zugeordnet werden — ' +
            'core.betrieb.lina_betrieb_id ist leer. Zuerst analyticsFilterOptions ' +
            'laufen lassen, dann diesen Posten erneut einreihen. ' +
            'Nachsehen: SELECT * FROM mart.betrieb_ohne_lina_id;',
            { endpunkt: k.ep.key, jahr, verworfen: zeilen.length })
        } else if (zeilen.length > rows.length) {
          log.warn('BWA-Zeilen ohne zuordenbaren Betrieb verworfen', {
            endpunkt: k.ep.key, jahr, verworfen: zeilen.length - rows.length, uebernommen: rows.length,
          })
        }

        // APPEND-ONLY: kein DO UPDATE. abgerufen_am ist Teil des Schlüssels,
        // damit die BWA-Historie über Nachbuchungen erhalten bleibt.
        await inBloecken(rows, 500, async b => {
          const { platzhalter, werte } = mehrzeilig(sp, b)
          await c.query(
            `INSERT INTO core.kennzahlen_monat (${sp.join(',')}) VALUES ${platzhalter}
             ON CONFLICT DO NOTHING`, werte)
        })

        /**
         * Der Buchungsstand — je Betrieb der jüngste Monat, für den je eine
         * BWA gebucht war.
         *
         * Ohne ihn kann die Plausibilitätsprüfung „hat nie eine BWA" nicht von
         * „dieser Monat ist noch nicht gebucht" unterscheiden und schlägt
         * jeden Monatsanfang grundlos an: am 26.07.2026 hatten 62 von 141
         * Betrieben nie eine gebuchte BWA, und von den 69 buchenden waren 38
         * einen Monat hinter der Spitze. Eine Null-Quote von über 70 % ist
         * hier der Normalzustand, kein Befund.
         *
         * Geschrieben werden ALLE Betriebe der Antwort, auch die ohne einen
         * einzigen gebuchten Monat — die bekommen letzter_monat = NULL. Der
         * Unterschied zwischen „NULL" und „gar keine Zeile" ist die Aussage:
         * nie gebucht gegen nie geprüft.
         *
         * `greatest` macht den Wert zu einem Höchststand. Das ist nötig, nicht
         * hübsch: gebucht heisst `wert_absolut`, und ein Posten aus
         * `getKennzahlen:relativ` allein füllt nur `wert_prozent`. Ohne
         * `greatest` würde jeder relative Abruf den Stand auf NULL zurück-
         * setzen. `greatest` überspringt NULL-Argumente.
         */
        const betroffen = [...new Set(rows.map(r => r.betrieb_key))]
        if (betroffen.length) {
          await c.query(
            `INSERT INTO core.bwa_buchungsstand (betrieb_key, letzter_monat, geprueft_am)
             SELECT v.betrieb_key,
                    (SELECT max(km.monat)
                       FROM core.kennzahlen_monat km
                      WHERE km.betrieb_key = v.betrieb_key
                        -- Wortgleich mit mart.round_table_basis. Zwei
                        -- Definitionen von "gebucht" wären zwei Wahrheiten.
                        AND km.wert_absolut IS NOT NULL
                        AND km.wert_absolut <> 0),
                    now()
               FROM unnest($1::int[]) AS v(betrieb_key)
             ON CONFLICT (betrieb_key) DO UPDATE SET
               letzter_monat = greatest(core.bwa_buchungsstand.letzter_monat,
                                        EXCLUDED.letzter_monat),
               geprueft_am = now()`,
            [betroffen])
        }
        /**
         * Die Markenzuordnung — nur aus diesem Endpunkt zu bekommen.
         *
         * `getKennzahlen` liefert dreistufig Konzept → Betrieb → Kennzahl und
         * ist damit die einzige Stelle, an der steht, WER zu welcher Marke
         * gehört. Ohne das bleibt jede Markenauswertung leer: 141 Betriebe
         * unter „(nicht zugeordnet)", und das Marken-Dashboard ist der
         * Einstieg der ganzen Drill-Down-Kette.
         *
         * Ersetzt statt ergänzt: LINA ist hier die Quelle der Wahrheit. Wird
         * ein Betrieb umgehängt, soll das ankommen und nicht als zweite
         * Zuordnung danebenstehen — sonst gilt er in mart.konzept_zuordnung
         * als „mehrdeutig" und fällt aus jedem Markenschnitt heraus. Betriebe,
         * die in dieser Antwort gar nicht vorkommen, bleiben unangetastet.
         */
        const bk = t.betriebKonzepte(k.daten)
        if (bk.length) {
          const r = await c.query(
            `WITH v AS (
               SELECT kn.konzept_key, b.betrieb_key
                 FROM unnest($1::int[], $2::int[]) AS x(gruppen_id, betrieb_id)
                 JOIN core.konzept kn ON kn.lina_gruppen_id = x.gruppen_id
                 JOIN core.betrieb b  ON b.lina_betrieb_id  = x.betrieb_id
             ), weg AS (
               DELETE FROM core.betrieb_konzept alt
                WHERE alt.betrieb_key IN (SELECT betrieb_key FROM v)
                  AND NOT EXISTS (SELECT 1 FROM v
                                   WHERE v.betrieb_key = alt.betrieb_key
                                     AND v.konzept_key = alt.konzept_key)
             )
             INSERT INTO core.betrieb_konzept (betrieb_key, konzept_key)
             SELECT betrieb_key, konzept_key FROM v
             ON CONFLICT DO NOTHING`,
            [bk.map(x => x.linaGruppenId), bk.map(x => x.linaBetriebId)])
          geschrieben += r.rowCount ?? 0

          // Zuordnungen, die ins Leere zeigen, sind kein Randfall, sondern der
          // Vorbote einer leeren Markenauswertung — genau wie bei der
          // BWA-Bruecke. Also laut sein statt still filtern.
          const fehlt = await c.query(
            `SELECT count(*)::int AS n
               FROM unnest($1::int[], $2::int[]) AS x(gruppen_id, betrieb_id)
              WHERE NOT EXISTS (SELECT 1 FROM core.konzept WHERE lina_gruppen_id = x.gruppen_id)
                 OR NOT EXISTS (SELECT 1 FROM core.betrieb WHERE lina_betrieb_id = x.betrieb_id)`,
            [bk.map(x => x.linaGruppenId), bk.map(x => x.linaBetriebId)])
          const n = Number(fehlt.rows[0]?.n ?? 0)
          if (n > 0) {
            log.warn('Markenzuordnungen ohne Gegenstueck verworfen', {
              endpunkt: k.ep.key, verworfen: n, von: bk.length,
              hinweis: 'analyticsFilterOptions muss vor getKennzahlen laufen — siehe einreihPrioritaet()',
            })
          }
        }

        geschrieben += rows.length
        break
      }

      case 'getAktionsbericht': {
        const { aktionen, zeilen } = t.aktionsbericht(k.daten, k.von)

        // 1. Die Aktionen als Dimension. Kommen in JEDER Antwort mit, auch
        //    wenn keine einzige Zelle gefüllt ist — deshalb steht die
        //    Dimension selbst dann, wenn es nichts zu buchen gibt.
        if (aktionen.length) {
          await c.query(
            `INSERT INTO core.aktion (lina_id, name, gueltig_von, gueltig_bis)
             SELECT v.lina_id, v.name, v.von, v.bis
               FROM unnest($1::int[], $2::text[], $3::date[], $4::date[])
                    AS v(lina_id, name, von, bis)
             ON CONFLICT (lina_id) DO UPDATE SET
               name = EXCLUDED.name,
               -- COALESCE und nicht EXCLUDED: eine Laufzeit, die LINA einmal
               -- kannte, soll eine spätere Antwort ohne Datumsangabe nicht
               -- wieder löschen.
               gueltig_von = COALESCE(EXCLUDED.gueltig_von, core.aktion.gueltig_von),
               gueltig_bis = COALESCE(EXCLUDED.gueltig_bis, core.aktion.gueltig_bis),
               zuletzt_am = now()`,
            [aktionen.map(a => a.linaId), aktionen.map(a => a.name),
             aktionen.map(a => a.gueltigVon), aktionen.map(a => a.gueltigBis)])
        }
        const akt = await c.query(`SELECT aktion_key, lina_id FROM core.aktion`)
        const akey = new Map(akt.rows.map(r => [Number(r.lina_id), Number(r.aktion_key)]))

        // 2. Die Umsätze. Null- und Nullwert-Zellen sind schon in der
        //    Transformation weggefallen; ein Tag ohne Aktionsumsatz schreibt
        //    hier also gar nichts. Das ist der Normalfall und kein Befund —
        //    am 25.07.2026 waren alle 423 Zellen leer.
        const sp = ['betrieb_key','geschaeftstag','aktion_key',
                    'umsatz_netto','umsatz_brutto','anteil_pct','raw_id'] as const
        const rows = zeilen
          .filter(z => bk(z.encId) && akey.has(z.linaAktionId))
          .map(z => ({
            betrieb_key: bk(z.encId)!, geschaeftstag: z.geschaeftstag,
            aktion_key: akey.get(z.linaAktionId)!,
            umsatz_netto: z.umsatzNetto, umsatz_brutto: z.umsatzBrutto,
            anteil_pct: z.anteilPct, raw_id: rawId,
          }))
        await inBloecken(rows, 500, async b => {
          const { platzhalter, werte } = mehrzeilig(sp, b)
          await c.query(
            `INSERT INTO core.aktionsumsatz_tag (${sp.join(',')}) VALUES ${platzhalter}
             ON CONFLICT (geschaeftstag, betrieb_key, aktion_key) DO UPDATE SET
               umsatz_netto = EXCLUDED.umsatz_netto, umsatz_brutto = EXCLUDED.umsatz_brutto,
               anteil_pct = EXCLUDED.anteil_pct,
               raw_id = EXCLUDED.raw_id, geladen_am = now()`, werte)
        })

        // Zellen mit Umsatz, die keiner bekannten Aktion zuzuordnen sind,
        // wären ein echter Verlust: die Zahl ist da, nur der Name fehlt.
        // Nach demselben Muster wie bei der BWA-Brücke laut statt still.
        if (zeilen.length > rows.length) {
          log.warn('Aktionsumsätze ohne zuordenbare Aktion oder Betrieb verworfen', {
            endpunkt: k.ep.key, tag: k.von,
            verworfen: zeilen.length - rows.length, uebernommen: rows.length,
            bekannteAktionen: akey.size,
          })
        }

        geschrieben = aktionen.length + rows.length
        break
      }

      case 'getZeitzonenbericht': {
        const sp = ['betrieb_key','geschaeftstag','stunde','umsatz_netto','raw_id'] as const
        const zeilen = t.zeitzonenbericht(k.daten, k.von)
          .filter(z => bk(z.encId))
          .map(z => ({
            betrieb_key: bk(z.encId)!, geschaeftstag: z.geschaeftstag,
            stunde: z.stunde, umsatz_netto: z.umsatzNetto, raw_id: rawId,
          }))
        await inBloecken(zeilen, 1000, async b => {
          const { platzhalter, werte } = mehrzeilig(sp, b)
          await c.query(
            `INSERT INTO core.zeitzonenbericht_stunde (${sp.join(',')}) VALUES ${platzhalter}
             ON CONFLICT (betrieb_key, geschaeftstag, stunde) DO UPDATE SET
               umsatz_netto = EXCLUDED.umsatz_netto, raw_id = EXCLUDED.raw_id, geladen_am = now()`, werte)
        })
        geschrieben = zeilen.length
        break
      }

      case 'getVordefinierteZeitzonenBericht': {
        const zr = await c.query(`SELECT zeitzone_key, lina_id FROM core.zeitzone`)
        const zmap = new Map(zr.rows.map(z => [Number(z.lina_id), Number(z.zeitzone_key)]))
        const sp = ['betrieb_key','geschaeftstag','zeitzone_key','umsatz_netto','raw_id'] as const
        const zeilen = t.vordefinierteZeitzonen(k.daten, k.von)
          .filter(z => bk(z.encId) && zmap.has(z.linaZoneId))
          .map(z => ({
            betrieb_key: bk(z.encId)!, geschaeftstag: z.geschaeftstag,
            zeitzone_key: zmap.get(z.linaZoneId)!, umsatz_netto: z.umsatzNetto, raw_id: rawId,
          }))
        await inBloecken(zeilen, 1000, async b => {
          const { platzhalter, werte } = mehrzeilig(sp, b)
          await c.query(
            `INSERT INTO core.zeitzonenbericht_zone (${sp.join(',')}) VALUES ${platzhalter}
             ON CONFLICT (betrieb_key, geschaeftstag, zeitzone_key) DO UPDATE SET
               umsatz_netto = EXCLUDED.umsatz_netto, raw_id = EXCLUDED.raw_id, geladen_am = now()`, werte)
        })
        geschrieben = zeilen.length
        break
      }

      case 'getArtikelverkaufsbericht': {
        const { stamm, zeilen } = t.artikelverkauf(k.daten, k.von)

        // Mengen, die keine sein können (siehe transform/index.ts, `menge`).
        // Wie beim Umsatzbericht: der Wert ist null, der Tag zählt trotzdem
        // als erledigt — eine kaputte Zelle wirft 12.820 gute nicht weg.
        const verworfeneMengen = zeilen.flatMap(
          z => (z.verworfen ?? []).map(v => ({ ...v, encId: z.encId, artikelnummer: z.artikelnummer })))
        if (verworfeneMengen.length) {
          log.warn('unplausible Verkaufsmenge verworfen', {
            endpunkt: k.ep.key, tag: k.von, anzahl: verworfeneMengen.length,
            beispiel: verworfeneMengen[0],
          })
          await c.query(
            `INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich)
             VALUES ($1, $2, $3)`,
            [k.ep.key,
             JSON.stringify({ hinweis: 'counts sind Verkaufsmengen unter 10^9' }),
             JSON.stringify({ geschaeftstag: k.von, raw_id: rawId, verworfen: verworfeneMengen })])
        }

        const amap = await artikelSichern(c, stamm)
        await artikelStandFortschreiben(c, stamm, k.von, amap)
        const sp = ['betrieb_key','geschaeftstag','artikel_key','menge',
                    'umsatz_netto','umsatz_brutto','verkaufspreis','raw_id'] as const
        const rows = zeilen
          .filter(z => bk(z.encId) && amap.has(z.artikelnummer))
          .map(z => ({
            betrieb_key: bk(z.encId)!, geschaeftstag: z.geschaeftstag,
            artikel_key: amap.get(z.artikelnummer)!,
            menge: z.menge, umsatz_netto: z.umsatzNetto, umsatz_brutto: z.umsatzBrutto,
            verkaufspreis: z.verkaufspreis, raw_id: rawId,
          }))
        await inBloecken(rows, 1000, async b => {
          const { platzhalter, werte } = mehrzeilig(sp, b)
          await c.query(
            `INSERT INTO core.artikelverkauf_tag (${sp.join(',')}) VALUES ${platzhalter}
             ON CONFLICT (geschaeftstag, betrieb_key, artikel_key) DO UPDATE SET
               menge = EXCLUDED.menge, umsatz_netto = EXCLUDED.umsatz_netto,
               umsatz_brutto = EXCLUDED.umsatz_brutto, verkaufspreis = EXCLUDED.verkaufspreis,
               raw_id = EXCLUDED.raw_id, geladen_am = now()`, werte)
        })
        geschrieben = rows.length
        break
      }

      // --- Stammdaten-Momentaufnahmen -----------------------------------
      //
      // `k.von` ist bei diesen Endpunkten der Monatserste (siehe
      // istMomentaufnahme in endpunkte.ts) und damit der Monat, für den die
      // *_stand-Tabellen fortgeschrieben werden.
      //
      // Die Fremdschlüssel zwischen den Stammdaten sind absichtlich NULLABLE:
      // Einheiten, Lieferanten und Waren kommen als getrennte Posten und in
      // beliebiger Reihenfolge an. Wer zuerst da ist, wird ohne Verweis
      // gespeichert; die nächste Momentaufnahme im Folgemonat hat dann alles
      // beisammen. Das ist besser, als einen Posten scheitern zu lassen und
      // ihn 20 Minuten später erneut gegen LINA zu holen.
      case 'analyticsFilterOptions': {
        /**
         * Zuerst die Betriebs-IDs — das ist der wichtigere Teil dieses
         * Endpunkts, auch wenn er nicht so aussieht.
         *
         * `getKennzahlen` kennt Betriebe nur über eine numerische LINA-ID,
         * der Umsatzbericht nur über `encId`. Ohne Brücke findet keine
         * einzige BWA-Zeile ihren Betrieb: Am 26.07.2026 fielen so alle
         * 7.860 Kennzahlenzeilen still durch den Filter, während der Posten
         * `ok` meldete und `core.kennzahlen_monat` leer blieb. Die BWA ist
         * die Grundlage des Round Table — ein leiserer Totalausfall ist
         * schwer vorstellbar.
         *
         * Verbunden wird über den Namen, weil `encId` in dieser Antwort
         * nicht vorkommt. Nachgemessen: Namen beidseitig eindeutig (141 von
         * 141) und vollständig treffend, gleicher ID-Raum wie getKennzahlen
         * (131 von 131 Schnittmenge).
         */
        const mitId = t.betriebeMitLinaId(k.daten)
        let zugeordnet = 0
        if (mitId.length) {
          const r = await c.query(
            `UPDATE core.betrieb b
                SET lina_betrieb_id = v.lina_id, zuletzt_am = now()
               FROM unnest($1::int[], $2::text[]) AS v(lina_id, name)
              WHERE b.name = v.name
                AND b.lina_betrieb_id IS DISTINCT FROM v.lina_id`,
            [mitId.map(b => b.linaId), mitId.map(b => b.name)])
          zugeordnet = r.rowCount ?? 0
        }

        /**
         * Die Marken. LINA nennt sie im Filter „Konzepte", in der API
         * `gruppen` — es muss nichts aus Betriebsnamen geraten werden.
         *
         * Die Zuordnung, WER zu welcher Marke gehört, kommt nicht von hier,
         * sondern aus `getKennzahlen`. Dieser Endpunkt kennt nur die Liste.
         */
        const kz = t.konzepte(k.daten)
        if (kz.length) {
          await c.query(
            `INSERT INTO core.konzept (lina_gruppen_id, name)
             SELECT v.id, v.name FROM unnest($1::int[], $2::text[]) AS v(id, name)
             ON CONFLICT (lina_gruppen_id) DO UPDATE SET name = EXCLUDED.name`,
            [kz.map(x => x.linaGruppenId), kz.map(x => x.name)])
        }

        const fs = t.feinsparten(k.daten)
        await inBloecken(fs, 500, async b => {
          const { platzhalter, werte } = mehrzeilig(
            ['lina_id', 'nummer', 'name'],
            b.map(f => ({ lina_id: f.linaId, nummer: f.nummer, name: f.name })))
          await c.query(
            `INSERT INTO core.feinsparte (lina_id, nummer, name) VALUES ${platzhalter}
             ON CONFLICT (lina_id) DO UPDATE SET
               nummer = EXCLUDED.nummer, name = EXCLUDED.name`, werte)
        })
        geschrieben = fs.length + zugeordnet
        break
      }

      case 'articleApi:franchise': {
        const zeilen = t.artikelWarengruppen(k.daten)

        // 1. Die drei Warengruppenebenen als Dimension.
        const gruppen = new Map<string, { ebene: string; linaId: number; name: string }>()
        for (const a of zeilen) {
          for (const [ebene, g] of [['gross', a.gross], ['mec', a.mec], ['detail', a.detail]] as const) {
            if (g) gruppen.set(`${ebene}:${g.linaId}`, { ebene, linaId: g.linaId, name: g.name })
          }
        }
        // unnest mit typisierten Arrays statt einer VALUES-Liste: in einem
        // VALUES ohne explizite Typen hält Postgres die Parameter für text
        // und findet den Enum-Typ nicht. Dasselbe Muster wie bei
        // artikelStandFortschreiben.
        await inBloecken([...gruppen.values()], 500, async b => {
          await c.query(
            `INSERT INTO core.warengruppe (ebene, lina_id, name)
             SELECT v.ebene::core.warengruppe_ebene, v.lina_id, v.name
               FROM unnest($1::text[], $2::int[], $3::text[]) AS v(ebene, lina_id, name)
             ON CONFLICT (ebene, lina_id) DO UPDATE SET
               name = EXCLUDED.name, zuletzt_am = now()`,
            [b.map(g => g.ebene), b.map(g => g.linaId), b.map(g => g.name)])
        })
        const gr = await c.query(`SELECT warengruppe_key, ebene::text AS ebene, lina_id FROM core.warengruppe`)
        const gkey = new Map(gr.rows.map(r => [`${r.ebene}:${r.lina_id}`, Number(r.warengruppe_key)]))

        // 2. Zuordnung je Artikel — nur für Artikel, die wir schon kennen.
        //    core.artikel wird vom Verkaufsbericht gefüllt; articleApi kennt
        //    9.132 Artikel, verkauft wird davon ein Bruchteil. Wer nie
        //    verkauft wurde, braucht auch keine Warengruppenhistorie.
        const nummern = zeilen.map(a => a.artikelnummer)
        const ar = await c.query(
          `SELECT artikel_key, artikelnummer FROM core.artikel WHERE artikelnummer = ANY($1)`, [nummern])
        const akey = new Map(ar.rows.map(r => [Number(r.artikelnummer), Number(r.artikel_key)]))

        const sp = ['artikel_key', 'monat', 'gross_key', 'mec_key', 'detail_key'] as const
        const rows = zeilen
          .filter(a => akey.has(a.artikelnummer))
          .map(a => ({
            artikel_key: akey.get(a.artikelnummer)!,
            monat: k.von,
            gross_key: a.gross ? gkey.get(`gross:${a.gross.linaId}`) ?? null : null,
            mec_key: a.mec ? gkey.get(`mec:${a.mec.linaId}`) ?? null : null,
            detail_key: a.detail ? gkey.get(`detail:${a.detail.linaId}`) ?? null : null,
          }))
        await inBloecken(rows, 500, async b => {
          const { platzhalter, werte } = mehrzeilig(sp, b)
          await c.query(
            `INSERT INTO core.artikel_warengruppe_stand (${sp.join(',')}) VALUES ${platzhalter}
             ON CONFLICT (artikel_key, monat) DO UPDATE SET
               gross_key = EXCLUDED.gross_key, mec_key = EXCLUDED.mec_key,
               detail_key = EXCLUDED.detail_key`, werte)
        })

        /**
         * Null Zuordnungen sind kein Normalfall, sondern ein Totalausfall.
         *
         * Zugeordnet wird nur, was `core.artikel` schon kennt — und der
         * Katalog wird vom Artikelverkaufsbericht gefüllt. Läuft diese
         * Momentaufnahme, bevor genug Artikel da sind, schreibt sie NICHTS
         * und meldet trotzdem `ok`. Genau so passiert am 26.07.2026: der
         * Posten lief um 10:21, `core.artikel` war leer, 0 von 9.132
         * Zuordnungen — und weil es eine MONATLICHE Momentaufnahme ist,
         * wäre der nächste Versuch erst im August gewesen.
         *
         * Ein ganzer Monat ohne Warengruppen heißt: mart.artikelverkauf
         * ohne Sortimentsdimension und mart.deckungsbeitrag_warengruppe
         * ohne Gruppierung.
         */
        if (zeilen.length > 0 && rows.length === 0) {
          log.error(
            'keine einzige Warengruppenzuordnung geschrieben — core.artikel ist (noch) leer. ' +
            'Erst den Artikelverkaufsbericht laufen lassen, dann diesen Posten erneut einreihen. ' +
            'Sonst fehlt die Sortimentsdimension bis zur nächsten Momentaufnahme im Folgemonat.',
            { endpunkt: k.ep.key, monat: k.von, angeboten: zeilen.length, bekannteArtikel: akey.size })
        } else if (rows.length < zeilen.length / 10) {
          // articleApi kennt 9.132 Artikel, verkauft wird davon ein Bruchteil
          // — wenige Treffer sind also normal. Sehr wenige nicht.
          log.warn('auffällig wenige Warengruppenzuordnungen', {
            endpunkt: k.ep.key, monat: k.von, zugeordnet: rows.length, angeboten: zeilen.length,
          })
        }

        geschrieben = rows.length
        break
      }

      // ENTFALLEN AM 01.08.2026 (Migration 0030): die fünf Ladefälle
      // 'wawi:units', 'wawi:suppliers', 'wawi:items', 'wawi:orders' und
      // 'wawi:inventory'.
      //
      // LINAs Warenwirtschaft enthält Demodaten (AGENTS.md, Regel 5). Die
      // Zieltabellen — core.einheit, lieferant, ware, ware_stand,
      // einkaufspreis_stand, bestellung, bestellposten, inventurtermin —
      // sind in Migration 0030 gelöscht; die Endpunkte stehen in
      // lina/endpunkte.ts auf aktiv: false.
      //
      // Waren, Lieferanten, Bestellungen und Preise kommen seither aus
      // FoodNotify (core.ware, core.bestellung, core.bestellposition) —
      // und dort als BELEGPREISE mit Datum, nicht als Katalogpreise ohne
      // Historie. Siehe docs/plan-foodnotify.md.
      //
      // Der Raw-Layer behält die bereits geholten Antworten: raw.api_antwort
      // ist append-only, es ist nichts verloren.

      default:
        // Noch keine Transformation — der Raw-Layer hat die Daten trotzdem.
        // Nachträglich transformieren geht jederzeit, ohne LINA anzufassen.
        break
    }

    return geschrieben
  })
}
