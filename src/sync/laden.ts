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

    // Partition bei Bedarf — kein Wartungsjob, den man vergessen kann.
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
        const zeilen = t.umsatzbericht(k.daten, k.von, posId)
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
        // APPEND-ONLY: kein DO UPDATE. abgerufen_am ist Teil des Schlüssels,
        // damit die BWA-Historie über Nachbuchungen erhalten bleibt.
        await inBloecken(rows, 500, async b => {
          const { platzhalter, werte } = mehrzeilig(sp, b)
          await c.query(
            `INSERT INTO core.kennzahlen_monat (${sp.join(',')}) VALUES ${platzhalter}
             ON CONFLICT DO NOTHING`, werte)
        })
        geschrieben = rows.length
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

      default:
        // Noch keine Transformation — der Raw-Layer hat die Daten trotzdem.
        // Nachträglich transformieren geht jederzeit, ohne LINA anzufassen.
        break
    }

    return geschrieben
  })
}
