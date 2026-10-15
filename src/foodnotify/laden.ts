/**
 * FoodNotify: raw → core, ein Posten je Transaktion.
 *
 * Drei Aufgaben in einem Schritt, bewusst in EINER Transaktion:
 *
 *   1. Raw sichern — die Versicherung, immer, auch bei leerer Antwort
 *      (AGENTS.md Regel 4: alles in core ist daraus neu aufbaubar).
 *   2. Transformieren nach core (kostenstelle, bestellung, …).
 *   3. FOLGEPOSTEN EINREIHEN. Der Backfill steuert sich selbst: die
 *      Kostenstellen reihen die erste Bestellseite je erpId ein, jede
 *      Seite reiht ihre Bestellköpfe, Positionen und die nächste Seite
 *      ein. Wer einmal `--foodnotify` einreiht, bekommt den Rest von
 *      allein — abbruchfest, weil Einreihen und Laden zusammen
 *      festgeschrieben werden: kein geladener Posten ohne seine Folge.
 *
 * Und die Leere-200er-Regel: anders als bei LINA (wo HTTP 500 mit leerem
 * Body ein Normalzustand ist) ist eine 200er-Antwort mit null Zeilen
 * verdächtig, sobald dieselbe Kombination schon einmal Daten geliefert
 * hat — der Wilma-Wunder-Fehler war genau das: HTTP 200, leeres Ergebnis,
 * 275 Inventuren übersehen, lautlos.
 */
import type { PoolClient } from 'pg'
import { inTransaktion, eine } from '../db/pool'
import { log } from '../lib/log'
import { auspacken, istLeer } from './huelle'
import * as t from './transform'
import * as inv from './inventur'
import * as rz from './rezept'
import type { FnEndpunkt } from './endpunkte'
import { config } from '../config'

type FnKontext = {
  ep: FnEndpunkt
  markeKey: number
  von: string
  bis: string
  parameter: Record<string, string>
  daten: unknown
  httpStatus: number
  bytes: number
  hash: string
  laufId: string
  /** sync.warteschlange.nachladen des Postens — Rezepturen reihen ihre Folgeposten im selben Weg ein. */
  nachladen?: boolean
}

/** Wie viele fachliche Zeilen stecken in der Antwort? */
export function zeilenZaehlen(daten: unknown): number {
  const { daten: inhalt } = auspacken(daten)
  if (Array.isArray(inhalt)) return inhalt.length
  if (inhalt === null || inhalt === undefined) return 0
  return istLeer(inhalt) ? 0 : 1
}

export async function fnLaden(k: FnKontext): Promise<number> {
  const zeilen = zeilenZaehlen(k.daten)

  /**
   * Die Leere-Prüfung VOR dem Speichern entscheiden, aber unabhängig davon
   * immer speichern: auch eine verdächtige Antwort gehört in den Raw-Layer —
   * sie ist der Beleg dafür, was der Server gesagt hat.
   */
  const verdaechtig = zeilen === 0 && await kamFrueherEtwas(k)

  /**
   * DIE FORM VOR DEM LADEN PRÜFEN — bisher nur für Rezepturen (Review
   * 15.10.2026). Eine unbekannte Hülle ergäbe dort still [] bzw. null, der
   * Lader löschte die Zutaten und stempelte zutaten_geholt_am. Bei einem
   * Befund: raw sichern, sync.schema_abweichung schreiben, dann werfen — der
   * Posten scheitert sichtbar (Wiedervorlage, später mart.posten_aufgegeben),
   * core bleibt unberührt.
   */
  const struktur = k.ep.key.startsWith('fn:rezept') ? rz.rezeptStrukturFehler(k.ep.key, k.daten) : null

  const ergebnis = await inTransaktion(async c => {
    await c.query(
      `SELECT core.partition_anlegen('raw.api_antwort', d)
         FROM unnest(ARRAY[current_date, current_date + 1]) AS d`)
    await c.query(
      `INSERT INTO raw.api_antwort
         (quelle, endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, parameter,
          http_status, payload, payload_hash, payload_bytes, lauf_id)
       VALUES ('foodnotify',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      // quelle explizit setzen — der Spalten-Default ist 'lina'.
      // Die Marke steht im parameter-JSON mit drin: raw.api_antwort hat keine
      // Mandantenspalte, und die Antwort selbst verrät ihren Mandanten nicht.
      [k.ep.key, null, k.von, k.bis,
       JSON.stringify({ ...k.parameter, markeKey: k.markeKey }),
       k.httpStatus, JSON.stringify(k.daten), k.hash, k.bytes, k.laufId])

    if (struktur) {
      await c.query(
        `INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich)
         VALUES ($1, $2, $3)`,
        [k.ep.key, JSON.stringify({ endpunkt: k.ep.key, hinweis: 'gemessene Antwortform' }),
         JSON.stringify({ probleme: [{ pfad: '', problem: `${struktur}. Parameter: ${JSON.stringify(k.parameter)}` }] })])
      return null
    }

    if (verdaechtig) {
      await c.query(
        `INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich)
         VALUES ($1, $2, $3)`,
        [k.ep.key,
         JSON.stringify({ endpunkt: k.ep.key, hinweis: 'Kombination lieferte früher Daten' }),
         JSON.stringify({ probleme: [{
           pfad: '', problem: `HTTP ${k.httpStatus} mit 0 Zeilen — früher kamen hier Daten. ` +
             `Möglicherweise eine neue Antworthülle (der Wilma-Wunder-Fehler). ` +
             `Parameter: ${JSON.stringify(k.parameter)}`,
         }] })])
      log.warn('leere 200er-antwort, kombination lieferte früher daten', {
        endpunkt: k.ep.key, markeKey: k.markeKey, parameter: k.parameter,
      })
    }

    switch (k.ep.key) {
      case 'fn:kostenstellen': {
        const ks = t.kostenstellen(k.daten)
        for (const z of ks) {
          await c.query(
            `INSERT INTO core.kostenstelle
               (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name, art)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (marke_key, kostenstelle_id) DO UPDATE SET
               restaurant_id = EXCLUDED.restaurant_id,
               erp_id = EXCLUDED.erp_id,
               name = EXCLUDED.name,
               restaurant_name = EXCLUDED.restaurant_name,
               -- art nur nachziehen, solange kein Mensch sie bestätigt hat:
               -- eine bestätigte Zuordnung überschreibt keine Ableitung.
               art = CASE WHEN core.kostenstelle.art_bestaetigt
                          THEN core.kostenstelle.art ELSE EXCLUDED.art END,
               zuletzt_am = now()`,
            [k.markeKey, z.kostenstelleId, z.restaurantId, z.erpId, z.name, z.restaurantName, z.art])
        }
        /**
         * Der Anstoß des Backfills: je Kostenstelle mit erpId die ERSTE
         * Bestellseite. NOT EXISTS gegen ALLE Posten (auch erledigte) —
         * beim zweiten Laden der Kostenstellen wird nichts erneut geholt.
         */
        for (const z of ks) {
          await folgepostenEinreihen(c, k.markeKey, 'fn:bestellungen',
            { erpId: String(z.erpId), seite: '1' }, k.von, 90)
        }
        return ks.length
      }

      case 'fn:pos_standorte': {
        const standorte = t.posStandorte(k.daten)
        for (const z of standorte) {
          await c.query(
            `UPDATE core.kostenstelle
                SET connection_id = $3, kassensystem = $4, zuletzt_am = now()
              WHERE marke_key = $1 AND kostenstelle_id = $2`,
            [k.markeKey, z.kostenstelleId, z.connectionId, z.kassensystem])
        }
        return standorte.length
      }

      case 'fn:bestellungen': {
        const seite = t.bestellliste(k.daten)
        const erpId = k.parameter.erpId
        if (!erpId) throw new Error('fn:bestellungen ohne erpId im Posten')
        const ksKey = await kostenstelleKey(c, k.markeKey, Number(erpId))

        for (const b of seite.bestellungen) {
          /**
           * DER FINGERABDRUCK ENTSCHEIDET, OB DAS DETAIL GEHOLT WIRD (0098).
           *
           * `RETURNING` liefert nach dem Upsert den NEUEN Listenstand gegen
           * den ALTEN Detailstand — genau die Frage, die hier zu beantworten
           * ist. Bei einer neuen Bestellung ist detail_fingerabdruck NULL,
           * `IS DISTINCT FROM` also wahr, und das Detail wird geholt wie
           * bisher.
           */
          const r = await c.query(
            `INSERT INTO core.bestellung
               (kostenstelle_key, fn_id, bestellnummer, bestellt_am, status,
                listen_fingerabdruck)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (kostenstelle_key, fn_id) DO UPDATE SET
               bestellnummer = EXCLUDED.bestellnummer,
               bestellt_am = EXCLUDED.bestellt_am,
               status = EXCLUDED.status,
               listen_fingerabdruck = EXCLUDED.listen_fingerabdruck
             RETURNING (listen_fingerabdruck IS DISTINCT FROM detail_fingerabdruck)
                       AS veraltet`,
            [ksKey, b.fnId, b.bestellnummer, b.bestelltAm, b.status, b.fingerabdruck])
          const veraltet = r.rows[0]?.veraltet === true
          /**
           * Kopf und Positionen je Bestellung. Der Zeitraum des Postens ist
           * das BESTELLDATUM — damit zeigt der Fortschritt, in welchem Jahr
           * der Backfill gerade steckt, statt überall "heute" zu melden.
           */
          const tag = (b.bestelltAm ?? k.von).slice(0, 10)
          const p = { erpId: String(erpId), orderId: b.fnId }
          /**
           * Priorität 89 — VOR den Seiten (90), nicht dahinter.
           *
           * posten_holen sortiert primär nach prioritaet. Lagen die Details
           * hinter den Seiten, arbeitete der Worker erst alle ~30.000 Seiten
           * ab, ehe er die erste Bestellung im Detail holte: nach Stunden
           * standen 17.077 Bestellköpfe ohne Lieferant, ohne Summe und ohne
           * eine einzige Position in core (gemessen 02.08.2026). Die Liste
           * liefert nur Nummer und Datum — der Gewinn steckt im Detail.
           * Vorn heißt: eine Seite bringt 25 Bestellungen, die vollständig
           * geladen werden, bevor die nächste Seite folgt.
           */
          /**
           * SPERRMODUS 'offen' UND NICHT 'alle' — seit Migration 0098.
           *
           * 'alle' hiess: je Bestellung genau ein Detailabruf, fuer immer.
           * Das war fuer den Backfill richtig und hat als laufender Abgleich
           * dazu gefuehrt, dass `bestelldetailsAuffrischen()` an der Sperre
           * vorbei einreihen musste — und weil dort niemand wusste, WAS sich
           * geaendert hat, holte es pauschal alles der letzten 45 Tage.
           *
           * Jetzt entscheidet der Fingerabdruck, und die Sperre muss nur noch
           * verhindern, dass derselbe Abruf zweimal GLEICHZEITIG in der
           * Schlange steht. Das ist genau 'offen'.
           */
          if (veraltet) {
            await folgepostenEinreihen(c, k.markeKey, 'fn:bestellung', p, tag, 89, 'offen')
            await folgepostenEinreihen(c, k.markeKey, 'fn:bestellpositionen', p, tag, 89, 'offen')
          }
        }

        /**
         * SEITE 1 REIHT ALLE ÜBRIGEN SEITEN EIN — RÜCKWÄRTS.
         *
         * Die Sortierung der Abfrage bleibt AUFSTEIGEND (order_direction=ASC,
         * siehe endpunkte.ts): nur so sind Seiteninhalte stabil, während der
         * Backfill läuft — neue Bestellungen entstehen auf NEUEN Seiten am
         * Ende, nichts verschiebt sich. Abgearbeitet wird aber von der
         * LETZTEN Seite zurück: dort stehen die neuesten Bestellungen, und
         * die will die Auswertung zuerst (Entscheidung Eugene, 02.08.2026 —
         * aktuelle Preise vor der Historie).
         *
         * posten_holen ordnet bei gleicher Priorität nach posten_id, also
         * nach Einreihreihenfolge — page_count zuerst eingereiht heißt
         * page_count zuerst geholt. Vorher lief hier eine Kette (jede Seite
         * reiht die nächste ein); das Einreihen aller Seiten auf einmal
         * macht zudem den Gesamtumfang sofort in der Schlange sichtbar.
         *
         * Was dabei bewusst offen bleibt: Seiten, die erst NACH diesem
         * Seite-1-Aufruf entstehen (neue Bestellungen), kennt niemand. Sie
         * holt der spätere laufende Abgleich — nicht diese Kette.
         */
        if (seite.aktuelleSeite === 1) {
          for (let n = seite.gesamtSeiten; n >= 2; n--) {
            await folgepostenEinreihen(c, k.markeKey, 'fn:bestellungen',
              { erpId: String(erpId), seite: String(n) }, k.von, 90)
          }
        }
        return seite.bestellungen.length
      }

      case 'fn:bestellung': {
        const kopf = t.bestellkopf(k.daten)
        const erpId = k.parameter.erpId
        const orderId = k.parameter.orderId
        if (!erpId || !orderId) throw new Error('fn:bestellung ohne erpId/orderId im Posten')
        const ksKey = await kostenstelleKey(c, k.markeKey, Number(erpId))

        let lieferantKey: number | null = null
        if (kopf.lieferant) {
          const r = await c.query(
            `INSERT INTO core.lieferant (marke_key, fn_id, name) VALUES ($1,$2,$3)
             ON CONFLICT (marke_key, fn_id) DO UPDATE SET name = EXCLUDED.name
             RETURNING lieferant_key`,
            [k.markeKey, kopf.lieferant.fnId, kopf.lieferant.name])
          lieferantKey = Number(r.rows[0].lieferant_key)
        }

        await c.query(
          `INSERT INTO core.bestellung
             (kostenstelle_key, fn_id, bestellnummer, lieferant_key, bestellt_am,
              geliefert_am, status, summe, beleg_nummer, beleg_datum, kommentar,
              detail_geholt_am)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
           ON CONFLICT (kostenstelle_key, fn_id) DO UPDATE SET
             bestellnummer = coalesce(EXCLUDED.bestellnummer, core.bestellung.bestellnummer),
             lieferant_key = coalesce(EXCLUDED.lieferant_key, core.bestellung.lieferant_key),
             bestellt_am   = coalesce(EXCLUDED.bestellt_am,   core.bestellung.bestellt_am),
             geliefert_am  = EXCLUDED.geliefert_am,
             status        = coalesce(EXCLUDED.status,        core.bestellung.status),
             summe         = EXCLUDED.summe,
             beleg_nummer  = EXCLUDED.beleg_nummer,
             beleg_datum   = EXCLUDED.beleg_datum,
             kommentar     = EXCLUDED.kommentar,
             -- Der Stempel des Auffrischens (0072). Er steht NUR hier, weil nur
             -- dieser Endpunkt Liefermenge, Lieferdatum und Preisstand bringt —
             -- der Listen-Upsert bei fn:bestellungen frischt allein den Status
             -- auf und darf deshalb nicht so tun, als sei das Detail geholt.
             detail_geholt_am = now(),
             -- UND FUER WELCHEN LISTENSTAND (0098). Damit ist beantwortbar,
             -- ob das Detail zum letzten Listeneintrag passt — die Frage, an
             -- der seit heute der naechste Abruf haengt.
             --
             -- Genommen wird der Stand, der JETZT in der Zeile steht. Das
             -- setzt voraus, dass die Liste dieser Kostenstelle waehrend
             -- eines Laufs nicht zweimal gelesen wird; sie wird es nicht
             -- (ein Posten je Seite und Lauf). Waere es anders, bliebe eine
             -- Aenderung bis zur naechsten haengen — sichtbar in
             -- mart.bestelldetail_offen, nicht verloren.
             detail_fingerabdruck = core.bestellung.listen_fingerabdruck`,
          [ksKey, orderId, kopf.bestellnummer, lieferantKey, kopf.bestelltAm,
           kopf.geliefertAm, kopf.status, kopf.summe, kopf.belegNummer,
           kopf.belegDatum, kopf.kommentar])
        return 1
      }

      case 'fn:bestellpositionen': {
        const positionen = t.bestellpositionen(k.daten)
        const erpId = k.parameter.erpId
        const orderId = k.parameter.orderId
        if (!erpId || !orderId) throw new Error('fn:bestellpositionen ohne erpId/orderId im Posten')
        const ksKey = await kostenstelleKey(c, k.markeKey, Number(erpId))

        const kopf = await c.query(
          `SELECT bestellung_key FROM core.bestellung
            WHERE kostenstelle_key = $1 AND fn_id = $2`, [ksKey, orderId])
        if (kopf.rows.length === 0) {
          // Positionen ohne Kopf gibt es nicht: der Kopf kommt aus derselben
          // Seite, die diesen Posten eingereiht hat. Fehlt er, ist etwas
          // grundsätzlich schief — werfen, damit es auffällt.
          throw new Error(`Bestellung ${orderId} (erpId ${erpId}) nicht in core.bestellung`)
        }
        const bestellungKey = Number(kopf.rows[0].bestellung_key)

        /**
         * Ersetzen statt upsert: die Antwort ist der VOLLSTÄNDIGE Stand der
         * Positionen. Eine gelöschte Position bliebe beim Upsert für immer
         * stehen — und Transaktion heißt: nie ein halber Stand sichtbar.
         */
        await c.query(`DELETE FROM core.bestellposition WHERE bestellung_key = $1`, [bestellungKey])
        for (const p of positionen) {
          /**
           * Die Ware zuerst über FoodNotifys eigene Nummer, ersatzweise
           * über die des Lieferanten. Die Quelle wird MITGESCHRIEBEN: es
           * sind zwei Nummernräume, und dieselbe Zahl kann in beiden
           * etwas anderes bedeuten.
           *
           * Ohne den Rückfall bliebe fast jede fünfte Position ohne Ware
           * — 55.408 von 310.761, gemessen am 03.08.2026.
           */
          const ware = p.wareFnId
            ? await wareKey(c, k.markeKey, 'concrete_product', p.wareFnId, p.wareName ?? p.name)
            : p.lieferantenNr
              ? await wareKey(c, k.markeKey, 'lieferant', p.lieferantenNr, p.name)
              : null
          await c.query(
            `INSERT INTO core.bestellposition
               (bestellung_key, fn_id, ware_key, name, menge, gebinde_menge, einheit,
                gesamt_menge, einzelpreis, preis_je_einheit, menge_unstimmig,
                lieferanten_nr, summe_preis, neuer_preis, preis_abweichend, ersetzt)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [bestellungKey, p.fnId, ware, p.name, p.menge, p.gebindeMenge, p.einheit,
             p.gesamtMenge, p.einzelpreis, p.preisJeEinheit, p.mengeUnstimmig,
             p.lieferantenNr, p.summePreis, p.neuerPreis,
             p.preisAbweichend, p.ersetzt])
        }
        return positionen.length
      }

      /**
       * B1 · Inventuren (plan-foodnotify.md Stufe 4) — lohnend fast nur bei
       * Wilma Wunder (275 Stück). Anders als bei Bestellungen bündelt EIN
       * Aufruf ALLE Kostenstellen der Marke (erpIds[]); die Kostenstelle
       * wird deshalb je ZEILE aufgelöst, nicht aus dem Posten-Parameter.
       */
      case 'fn:inventuren': {
        const seite = inv.inventurListe(k.daten)
        for (const iv of seite.inventuren) {
          const ksKey = await kostenstelleKey(c, k.markeKey, iv.erpId)
          await c.query(
            `INSERT INTO core.inventur
               (kostenstelle_key, fn_uuid, name, art, status, anzahl_positionen, notiz,
                erstellt_am, geaendert_am)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (kostenstelle_key, fn_uuid) DO UPDATE SET
               name = EXCLUDED.name,
               art = EXCLUDED.art,
               status = EXCLUDED.status,
               anzahl_positionen = EXCLUDED.anzahl_positionen,
               notiz = EXCLUDED.notiz,
               geaendert_am = EXCLUDED.geaendert_am,
               zuletzt_am = now()`,
            [ksKey, iv.fnUuid, iv.name, iv.art, iv.status, iv.anzahlPositionen, iv.notiz,
             iv.erstelltAm, iv.geaendertAm])

          /**
           * Die Positionen folgen automatisch — Zeitraum ist das Anlagedatum
           * der Inventur, wie bei Bestellungen das Bestelldatum.
           *
           * `seite: '1'` steht seit dem 13.08.2026 im Parameter, weil der
           * Endpunkt blättert. Das ändert zugleich den Idempotenzschlüssel:
           * `folgepostenEinreihen` vergleicht das ganze Parameter-JSON, und
           * die alten Posten tragen nur `{uuid}`. Jede Inventur, deren
           * Kopfseite erneut geladen wird, bekommt damit EINMAL einen frischen
           * Positionsposten — genau der Nachlauf, den die neun bei 800
           * abgeschnittenen Inventuren brauchen. Wer alle 358 auf einmal
           * nachziehen will, nimmt `bun run einreihen --foodnotify-inventurpositionen`.
           */
          const tag = (iv.erstelltAm ?? k.von).slice(0, 10)
          await folgepostenEinreihen(c, k.markeKey, 'fn:inventurpositionen',
            { uuid: iv.fnUuid, seite: '1' }, tag, 94)
        }

        /**
         * Wie bei fn:bestellungen: Seite 1 reiht alle übrigen Seiten auf
         * einmal ein, RÜCKWÄRTS (neueste zuerst). erpIds wird auf jeder
         * Folgeseite mitgeführt — endpunkte.ts baut den Pfad rein aus dem
         * Posten-Parameter, ohne Datenbankzugriff.
         */
        if (seite.aktuelleSeite === 1) {
          const erpIds = k.parameter.erpIds ?? ''
          for (let n = seite.gesamtSeiten; n >= 2; n--) {
            await folgepostenEinreihen(c, k.markeKey, 'fn:inventuren',
              { erpIds, seite: String(n) }, k.von, 95)
          }
        }
        return seite.inventuren.length
      }

      case 'fn:inventurpositionen': {
        const seite = inv.inventurpositionen(k.daten)
        const positionen = seite.positionen
        const uuid = k.parameter.uuid
        if (!uuid) throw new Error('fn:inventurpositionen ohne uuid im Posten')

        const kopf = await c.query(
          `SELECT i.inventur_key FROM core.inventur i
             JOIN core.kostenstelle ks USING (kostenstelle_key)
            WHERE ks.marke_key = $1 AND i.fn_uuid = $2`,
          [k.markeKey, uuid])
        if (kopf.rows.length === 0) {
          // Positionen ohne Kopf gibt es nicht: der Kopf kommt aus derselben
          // Liste, die diesen Posten eingereiht hat (wie bei Bestellungen).
          throw new Error(`Inventur ${uuid} (marke_key ${k.markeKey}) nicht in core.inventur`)
        }
        const inventurKey = Number(kopf.rows[0].inventur_key)

        /**
         * Ersetzen statt upsert — die Antwort ist der VOLLSTÄNDIGE Stand der
         * Zählung (wie core.bestellposition).
         *
         * NUR AUF SEITE 1. Seit dieser Endpunkt blättert (13.08.2026), wäre
         * ein Löschen je Seite der teuerste Fehler dieser Änderung: Seite 2
         * löschte, was Seite 1 gerade geschrieben hat, und am Ende stünden
         * genau die letzten 17 Positionen einer 817er-Inventur in der
         * Datenbank. Das sähe aus wie eine sehr kleine Inventur — wieder
         * lautlos, wieder plausibel, und schlimmer als der Fehler davor.
         *
         * Warum das trägt: Seite 1 reiht die Folgeseiten unten in DERSELBEN
         * Transaktion ein. Entweder ist gelöscht UND die Kette steht, oder
         * nichts von beidem.
         */
        if (seite.aktuelleSeite === 1) {
          await c.query(`DELETE FROM core.inventurposition WHERE inventur_key = $1`, [inventurKey])
        }
        for (const p of positionen) {
          // shopArticleId ist eine LIEFERANTEN-Artikelnummer — quelle
          // 'lieferant', wie core.bestellposition.lieferanten_nr. NICHT
          // 'concrete_product': plan-foodnotify.md warnt ausdrücklich davor,
          // diesen Schlüssel mit core.artikel zu verwechseln.
          const ware = p.lieferantenNr
            ? await wareKey(c, k.markeKey, 'lieferant', p.lieferantenNr, p.name)
            : null
          await c.query(
            `INSERT INTO core.inventurposition
               (inventur_key, fn_id, ware_key, name, shop_name, basis_einheit,
                soll_menge, gezaehlt_menge, nachzaehlung_menge, preis_je_basiseinheit)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [inventurKey, p.fnId, ware, p.name, p.shopName, p.basisEinheit,
             p.sollMenge, p.gezaehlteMenge, p.nachzaehlungMenge, p.preisJeBasiseinheit])
        }

        /**
         * Seite 1 reiht alle übrigen Seiten ein — genauso gebaut wie bei
         * fn:bestellungen und fn:inventuren, nicht anders. RÜCKWÄRTS, damit
         * `posten_holen()` (Priorität, dann posten_id) sie in derselben
         * Reihenfolge abarbeitet wie dort.
         *
         * Zeitraum ist der des auslösenden Postens: alle Seiten einer
         * Inventur gehören zu deren Anlagedatum, nicht zu heute.
         *
         * SPERRMODUS 'offen' — die einzige Stelle mit diesem Modus, und der
         * Grund steht ausführlich bei `folgepostenEinreihen()`. Kurz: eine
         * Inventur wird MEHRFACH nachgezogen (jede Kopfänderung löst einen
         * Zyklus aus), und mit der Alle-Posten-Sperre bliebe ab dem zweiten
         * Zyklus alles ab Seite 2 für immer aus. Wir hielten 800 statt
         * 1.426, und der Lauf löschte und lüde Seite 1 jede Nacht neu.
         */
        if (seite.aktuelleSeite === 1) {
          for (let n = seite.gesamtSeiten; n >= 2; n--) {
            await folgepostenEinreihen(c, k.markeKey, 'fn:inventurpositionen',
              { uuid, seite: String(n) }, k.von, 94, 'offen')
          }
        }
        return positionen.length
      }

      /**
       * Rezepturen (0132, docs/plan-rezepturen.md). ZWEI WEGE, unterschieden
       * am Posten (`k.nachladen`), nicht an der Uhr — Entscheidung Eugene,
       * 15.10.2026:
       *
       *   Tagesgeschäft (nachladen = false, Phase A): Seite 1 jeden Tag, dann
       *     die nächste Seite, solange eine Seite NEUE Rezepte trägt (die Liste
       *     ist nach createdAt absteigend sortiert, das Neueste vorn). Für neue
       *     Rezepte Zutaten und Meta, sofort, ohne Grenze.
       *   Nachladen (nachladen = true, Phase C): die volle Listenrunde einmal
       *     je Woche (`runde: 'voll'`, Seite 1 reiht alle übrigen ein), der
       *     erste Abzug und der Umlauf (rezepteNachfuellen()).
       */
      case 'fn:rezepte': {
        const { rezepte, seiten } = rz.rezeptliste(k.daten)
        const voll = k.parameter.runde === 'voll'
        const nachladen = k.nachladen === true || voll
        let neue = 0
        for (const r of rezepte) {
          const st = await rezeptSchreiben(c, k.markeKey, r, true)
          if (st.neu) neue++
          // Neue Rezepte sofort vollständig — im Weg, auf dem sie gefunden wurden.
          if (st.neu) await rezeptDetailsEinreihen(c, k.markeKey, r.fnId, false, k.von, nachladen)
        }
        await unterrezeptKeysNachziehen(c, k.markeKey, rezepte.map(r => r.fnId))

        if (seiten.aktuelleSeite === 1) {
          await c.query(
            `INSERT INTO core.rezept_liste_stand (marke_key, rezepte_gesamt, seiten, seite1_am, volle_runde_am)
             VALUES ($1, $2, $3, now(), CASE WHEN $4 THEN now() END)
             ON CONFLICT (marke_key) DO UPDATE SET
               rezepte_gesamt = EXCLUDED.rezepte_gesamt, seiten = EXCLUDED.seiten,
               seite1_am = now(),
               volle_runde_am = coalesce(EXCLUDED.volle_runde_am, core.rezept_liste_stand.volle_runde_am)`,
            [k.markeKey, seiten.gesamt, seiten.gesamtSeiten, voll])
        }

        if (voll) {
          /**
           * Die volle Runde: Seite 1 reiht alle übrigen ein. SPERRE 'offen':
           * die Runde kommt jede Woche wieder, ein erledigter Posten der
           * Vorwoche darf sie nicht sperren (der Einmalabruf-Fehler aus 0098).
           */
          if (seiten.aktuelleSeite === 1) {
            for (let n = 2; n <= seiten.gesamtSeiten; n++) {
              await folgepostenEinreihen(c, k.markeKey, 'fn:rezepte',
                { seite: String(n), runde: 'voll' }, k.von, 40, 'offen', true)
            }
          }
          /**
           * IST DIE RUNDE ABGESCHLOSSEN? Ja, wenn außer dieser Seite (die der
           * Worker erst nach dem Laden quittiert) keine Seite der Runde mehr
           * offen ist. Erst dann gilt die Liste als einmal ganz gelesen — daran
           * hängen „aus der Liste verschwunden", der Kopf im Umlauf und das
           * Weiterblättern des Tagesgeschäfts (Review 15.10.2026).
           */
          const offen = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM sync.warteschlange
              WHERE endpunkt = 'fn:rezepte' AND marke_key = $1 AND erledigt_am IS NULL
                AND parameter->>'runde' = 'voll' AND parameter <> $2::jsonb`,
            [k.markeKey, JSON.stringify(k.parameter)])
          if (Number(offen.rows[0]?.n ?? 0) === 0) {
            await c.query(
              `UPDATE core.rezept_liste_stand
                  SET volle_runde_fertig_beginn = volle_runde_am, volle_runde_fertig_ende = now()
                WHERE marke_key = $1 AND volle_runde_am IS NOT NULL`, [k.markeKey])
          }
        } else if (neue > 0 && seiten.aktuelleSeite < seiten.gesamtSeiten) {
          /**
           * Das Tagesgeschäft blättert weiter, solange eine Seite neue Rezepte
           * trägt — ABER NUR, wenn eine volle Runde die Liste schon einmal ganz
           * gelesen hat. ~~„solange die Marke noch gar keine Rezepte kennt"~~
           * reichte nicht (Review 15.10.2026): kennt eine Marke nach Nacht 1
           * nur Seite 1, wäre ab Nacht 2 jede weitere Seite „neu" gewesen, und
           * alle 507 Wilma-Wunder-Seiten samt Details liefen in Phase A. Vorher
           * holt das Tagesgeschäft nur die neuen Rezepte von Seite 1; der Rest
           * ist der erste Abzug in Phase C.
           *
           * Dazu ein harter Deckel (REZEPT_TAGESGESCHAEFT_SEITEN) als Sicherung.
           * Wird er erreicht, steht es in core.rezept_liste_stand — sichtbar,
           * nicht nur im Log (Regel 10).
           */
          const st = await c.query<{ fertig: boolean }>(
            `SELECT volle_runde_fertig_ende IS NOT NULL AS fertig
               FROM core.rezept_liste_stand WHERE marke_key = $1`, [k.markeKey])
          if (st.rows[0]?.fertig === true) {
            if (seiten.aktuelleSeite < config.REZEPT_TAGESGESCHAEFT_SEITEN) {
              await folgepostenEinreihen(c, k.markeKey, 'fn:rezepte',
                { seite: String(seiten.aktuelleSeite + 1) }, k.von, 40, 'offen', false)
            } else {
              await c.query(
                `UPDATE core.rezept_liste_stand SET tagesgeschaeft_gedeckelt_am = now() WHERE marke_key = $1`,
                [k.markeKey])
              log.warn('rezepte: tagesgeschaeft am seitendeckel, die volle runde holt den rest', {
                markeKey: k.markeKey, seite: seiten.aktuelleSeite, deckel: config.REZEPT_TAGESGESCHAEFT_SEITEN,
              })
            }
          }
        }
        return rezepte.length
      }

      case 'fn:rezept': {
        const kopf = rz.rezeptKopf(k.daten)
        if (!kopf) throw new Error(`fn:rezept ${k.parameter.rezeptId}: Antwort ohne Rezept-ID`)
        if (String(kopf.fnId) !== k.parameter.rezeptId) {
          throw new Error(`fn:rezept: angefragt ${k.parameter.rezeptId}, geliefert ${kopf.fnId}`)
        }
        // in_liste bleibt, was es war: ein Listenrezept, das auch über einen
        // Verweis kommt, wird dadurch nicht zum "nur über Verweis".
        const st = await rezeptSchreiben(c, k.markeKey, kopf, false)
        if (st.ohneZutaten) {
          await rezeptDetailsEinreihen(c, k.markeKey, kopf.fnId, false, k.von, k.nachladen === true)
        }
        await unterrezeptKeysNachziehen(c, k.markeKey, [kopf.fnId])
        return 1
      }

      case 'fn:rezept_zutaten': {
        const zutaten = rz.rezeptZutaten(k.daten)
        const rezeptKey = await rezeptKeyVon(c, k.markeKey, k.parameter.rezeptId)

        /**
         * ERSETZEN, nicht upsert — die Antwort ist der vollständige Stand des
         * Rezepts. Eine gestrichene Zutat bliebe beim Upsert für immer
         * stehen. In derselben Transaktion wie raw: nie ein halbes Rezept.
         */
        await c.query(`DELETE FROM core.zutat WHERE rezept_key = $1`, [rezeptKey])
        for (const z of zutaten) {
          await c.query(
            `INSERT INTO core.zutat
               (rezept_key, fn_id, position, art, name, artikelnummer, sub_rezept_key,
                sub_rezept_fn_id, menge, einheit, kosten, lieferant_name, lieferant_fn_id, gruppe,
                basis_menge, basis_einheit)
             VALUES ($1,$2,$3,$4,$5,$6,
                     (SELECT u.rezept_key FROM core.rezept u WHERE u.marke_key = $13 AND u.fn_id = $7),
                     $7,$8,$9,$10,$11,$12,$14,$15,$16)`,
            [rezeptKey, z.fnId, z.position, z.art, z.name, z.artikelnummer, z.subRezeptFnId,
             z.menge, z.einheit, z.kosten, z.lieferantName, z.lieferantFnId, k.markeKey, z.gruppe,
             z.basisMenge, z.basisEinheit])
        }
        await c.query(
          `UPDATE core.rezept SET zutaten_geholt_am = now(), fehlt_seit = NULL WHERE rezept_key = $1`, [rezeptKey])

        /**
         * VERWEISE OHNE REZEPT EINZELN NACHHOLEN, im Weg des Rezepts, das auf
         * sie zeigt (ein neues Rezept im Tagesgeschäft soll vollständig sein).
         * Die Liste zählt nicht alle Rezepte auf (56 Enchilada-Rezepte nur über
         * Verweise — vermutlich die archivierten, siehe core.rezept.archiviert).
         */
        const fehlend = await c.query<{ fn_id: number }>(
          `SELECT DISTINCT z.sub_rezept_fn_id AS fn_id
             FROM core.zutat z
            WHERE z.rezept_key = $1 AND z.sub_rezept_fn_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM core.rezept u
                               WHERE u.marke_key = $2 AND u.fn_id = z.sub_rezept_fn_id)`,
          [rezeptKey, k.markeKey])
        for (const f of fehlend.rows) {
          await folgepostenEinreihen(c, k.markeKey, 'fn:rezept',
            { rezeptId: String(f.fn_id) }, k.von, 41, 'offen', k.nachladen === true)
        }
        return zutaten.length
      }

      case 'fn:rezept_meta': {
        const m = rz.rezeptMeta(k.daten)
        const rezeptKey = await rezeptKeyVon(c, k.markeKey, k.parameter.rezeptId)
        await c.query(
          `UPDATE core.rezept
              SET gewicht_gesamt = $2, gewicht_person = $3, portion = $4,
                  portion_einheit = $5, verlust_roh = $6, meta_geholt_am = now(), fehlt_seit = NULL
            WHERE rezept_key = $1`,
          [rezeptKey, m.gewichtGesamt, m.gewichtPerson, m.portion, m.portionEinheit, m.verlustRoh])
        return 1
      }

      default:
        // Nur raw (fn:profil, fn:betriebe) — nachträglich transformieren geht
        // jederzeit, ohne FoodNotify anzufassen.
        return zeilen
    }
  })
  if (ergebnis === null) {
    throw new Error(`Antwortform unbekannt — Rohantwort gesichert, core unverändert: ${struktur}`)
  }
  return ergebnis
}

/**
 * Wogegen ein Folgeposten gesperrt wird.
 *
 *   alle   gegen JEDEN Posten derselben Parameter, erledigte eingeschlossen.
 *          Das ist die Sperre eines EINMALIGEN Abrufs: was einmal geholt
 *          wurde, wird nicht erneut geholt. Die Warnung aus 0005 gilt hier —
 *          der Offen-Index ist partiell, ein ON CONFLICT DO NOTHING wuerde
 *          Erledigtes erneut einreihen.
 *   offen  nur gegen einen noch OFFENEN Posten. Das ist die Sperre eines
 *          WIEDERHOLBAREN Abrufs: er soll nicht zweimal gleichzeitig laufen,
 *          aber sehr wohl ein zweites Mal.
 */
type Sperrmodus = 'alle' | 'offen'

/**
 * Folgeposten idempotent einreihen.
 *
 * WARUM ES HIER ZWEI MODI GIBT — der Fehler vom 13.08.2026.
 *
 * Bis dahin sperrte diese Funktion ausnahmslos gegen ALLE Posten. Fuer die
 * Seiten von `fn:bestellungen` und fuer die Bestelldetails ist das richtig:
 * sie werden je Parameter genau einmal geholt.
 *
 * Fuer die Folgeseiten von `fn:inventurpositionen` ist es falsch, und zwar
 * verlustbringend. Eine Inventur wird nachgezogen, sobald ihr Kopf mehr
 * Positionen meldet als geladen sind (`inventurpositionenNachziehen()`), und
 * das kann JEDES MAL passieren, wenn in FoodNotify eine Position dazukommt
 * oder wegfaellt. Im ZWEITEN Zyklus einer Inventur mit mehr als 800
 * Positionen loescht Seite 1 den ganzen Bestand, schreibt 800 zurueck — und
 * Seite 2 wird nicht mehr eingereiht, weil der ERLEDIGTE Zwilling
 * {uuid, seite:'2'} aus dem ersten Zyklus sperrt. `sync.warteschlange` wird
 * nie aufgeraeumt, die Sperre ist also dauerhaft. Ergebnis: wir halten 800
 * statt 1.426, die Invariante bleibt ungleich, und der naechste Lauf
 * wiederholt Loeschen und Neuladen von Seite 1 — jede Nacht, fuer immer.
 *
 * Am 13.08.2026 in Produktion gemessen: 9 Inventuren ueber 800 Positionen
 * (Maximum 1.426), und fuer alle neun stand der erledigte {uuid, seite:'2'}
 * bereits in der Warteschlange. Die Sperre war also bei allen neun schon
 * scharf; der zweite Zyklus haette exakt die 936 Positionen wieder verloren,
 * die der erste gerade zurueckgeholt hat. Dass der erste Zyklus gut ging,
 * lag allein am Formatwechsel — die alten Posten trugen {uuid}, die neuen
 * {uuid, seite}. Ein einmaliger Zufall, kein Schutz.
 *
 * Warum 'offen' fuer die Folgeseiten genuegt: Seite 1 reiht sie in DERSELBEN
 * Transaktion ein, in der sie loescht. Innerhalb eines Zyklus sind sie damit
 * offen und gesperrt; ein zweiter Zyklus beginnt erst, wenn der erste
 * abgearbeitet ist (`inventurpositionenNachziehen()` sperrt gegen jeden
 * offenen Posten derselben Inventur, gleich welcher Seite).
 */
async function folgepostenEinreihen(
  c: PoolClient, markeKey: number, endpunkt: string,
  parameter: Record<string, string>, zeitraum: string, prioritaet: number,
  sperre: Sperrmodus = 'alle', nachladen = false,
): Promise<number> {
  const r = await c.query(
    `INSERT INTO sync.warteschlange
       (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter, nachladen)
     SELECT $1, $2::date, $2::date, $3, $4, $5::jsonb, $7
      WHERE NOT EXISTS (
            SELECT 1 FROM sync.warteschlange w
             WHERE w.endpunkt = $1 AND w.marke_key = $4 AND w.parameter = $5::jsonb
               AND ($6 = 'alle' OR w.erledigt_am IS NULL))`,
    [endpunkt, zeitraum, prioritaet, markeKey, JSON.stringify(parameter), sperre, nachladen])
  return r.rowCount ?? 0
}

/** kostenstelle_key über (marke, erpId) — wirft, wenn die Kostenstelle fehlt. */
async function kostenstelleKey(c: PoolClient, markeKey: number, erpId: number): Promise<number> {
  const r = await c.query(
    `SELECT kostenstelle_key FROM core.kostenstelle WHERE marke_key = $1 AND erp_id = $2`,
    [markeKey, erpId])
  if (r.rows.length === 0) {
    // Bestellposten entstehen aus fn:kostenstellen — fehlt die Kostenstelle,
    // ist die Reihenfolge verletzt oder die erpId falsch. Beides soll knallen.
    throw new Error(`Keine Kostenstelle für erpId ${erpId} (marke_key ${markeKey}) — erst fn:kostenstellen laden`)
  }
  return Number(r.rows[0].kostenstelle_key)
}

/** ware_key über (marke, fn_id) — legt die Ware bei Bedarf mit Namen an. */
/**
 * Die Ware anlegen oder wiederfinden — je Nummernraum getrennt.
 *
 * `quelle` unterscheidet FoodNotifys eigene Warennummer
 * (`concrete_product`) von der des Lieferanten (`lieferant`). Beide sind
 * Zahlen ohne gemeinsamen Ursprung; ohne die Trennung könnten sie
 * kollidieren, und die Verwechslung wäre später nicht mehr aufzuklären.
 */
async function wareKey(
  c: PoolClient, markeKey: number, quelle: 'concrete_product' | 'lieferant',
  fnId: string, name: string,
): Promise<number> {
  const r = await c.query(
    `INSERT INTO core.ware (marke_key, quelle, fn_id, name) VALUES ($1,$2,$3,$4)
     ON CONFLICT (marke_key, quelle, fn_id) DO UPDATE SET
       name = EXCLUDED.name, zuletzt_am = now()
     RETURNING ware_key`,
    [markeKey, quelle, fnId, name])
  return Number(r.rows[0].ware_key)
}

/**
 * Gab es für genau diese Kombination (Endpunkt, Mandant, Parameter) schon
 * einmal eine Antwort mit Zeilen? Der Index aufgabe_fn_kombination (0032)
 * deckt genau diese Frage.
 */
async function kamFrueherEtwas(k: FnKontext): Promise<boolean> {
  const r = await eine<{ ja: boolean }>(
    `SELECT true AS ja FROM sync.aufgabe
      WHERE endpunkt = $1 AND marke_key = $2 AND parameter = $3::jsonb
        AND status = 'ok' AND zeilen > 0
      LIMIT 1`,
    [k.ep.key, k.markeKey, JSON.stringify(k.parameter)])
  return Boolean(r?.ja)
}


// ---------------------------------------------------------------------------
// Rezepturen — Hilfen
// ---------------------------------------------------------------------------

/**
 * Zutaten und Meta eines Rezepts einreihen (und den Kopf, wenn gewünscht) —
 * immer als Paar: ein Rezept mit Zutaten, aber ohne Meta, wäre ein halber
 * Stand. `nachladen` entscheidet die Phase (Tagesgeschäft oder Phase C).
 * Seit dem 15.10.2026 ohne Obergrenze (Entscheidung Eugene).
 */
export async function rezeptDetailsEinreihen(
  c: PoolClient, markeKey: number, fnId: number, mitKopf: boolean,
  zeitraum: string, nachladen: boolean,
): Promise<number> {
  const p = { rezeptId: String(fnId) }
  let n = 0
  if (mitKopf) n += await folgepostenEinreihen(c, markeKey, 'fn:rezept', p, zeitraum, 41, 'offen', nachladen)
  n += await folgepostenEinreihen(c, markeKey, 'fn:rezept_zutaten', p, zeitraum, 41, 'offen', nachladen)
  n += await folgepostenEinreihen(c, markeKey, 'fn:rezept_meta', p, zeitraum, 41, 'offen', nachladen)
  return n
}

/**
 * HTTP 404 auf einen Rezeptabruf (Worker und Praxislauf, dieselbe Stelle):
 * Posten als 'nicht_gefunden' schließen — nicht 'aufgegeben', das würde
 * wiederbelebt — und am Rezept fehlt_seit setzen.
 */
export async function rezeptNichtGefunden(
  postenId: number | string, markeKey: number, rezeptId: string | undefined, fehler: string,
): Promise<void> {
  await inTransaktion(async c => {
    await c.query(
      `UPDATE sync.warteschlange
          SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'nicht_gefunden', letzter_fehler = $1
        WHERE posten_id = $2`, [fehler.slice(0, 2000), postenId])
    if (/^\d+$/.test(rezeptId ?? '')) {
      await c.query(
        `UPDATE core.rezept SET fehlt_seit = coalesce(fehlt_seit, now())
          WHERE marke_key = $1 AND fn_id = $2`, [markeKey, Number(rezeptId)])
    }
  })
}

/**
 * Rezept anlegen oder auffrischen. Gibt zurück, ob ihm noch die Zutaten fehlen.
 *
 * `ausListe` setzt in_liste = true; ein Kopf über /api/recipes/{id} lässt den
 * Wert stehen (bei einem neuen Rezept also false — "nur über Verweis").
 */
async function rezeptSchreiben(
  c: PoolClient, markeKey: number, r: rz.RezeptKopf, ausListe: boolean,
): Promise<{ ohneZutaten: boolean; neu: boolean }> {
  const res = await c.query<{ ohne_zutaten: boolean; neu: boolean }>(
    `INSERT INTO core.rezept (marke_key, fn_id, name, erstellt_am, gruppen, in_liste, archiviert)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (marke_key, fn_id) DO UPDATE SET
       name = EXCLUDED.name,
       erstellt_am = EXCLUDED.erstellt_am,
       gruppen = EXCLUDED.gruppen,
       in_liste = core.rezept.in_liste OR EXCLUDED.in_liste,
       archiviert = coalesce(EXCLUDED.archiviert, core.rezept.archiviert),
       zuletzt_am = now(),
       fehlt_seit = NULL
     RETURNING zutaten_geholt_am IS NULL AS ohne_zutaten, (xmax = 0) AS neu`,
    [markeKey, r.fnId, r.name, r.erstelltAm, r.gruppen, ausListe, r.archiviert])
  return { ohneZutaten: res.rows[0]?.ohne_zutaten === true, neu: res.rows[0]?.neu === true }
}

/**
 * sub_rezept_key nachziehen, sobald das Unterrezept da ist. Die Sichten lösen
 * über (marke_key, sub_rezept_fn_id) auf und brauchen das nicht — der Schlüssel
 * ist für Postico und für den Fremdschlüssel da.
 */
async function unterrezeptKeysNachziehen(c: PoolClient, markeKey: number, fnIds: number[]) {
  if (fnIds.length === 0) return
  await c.query(
    `UPDATE core.zutat z SET sub_rezept_key = u.rezept_key
       FROM core.rezept p, core.rezept u
      WHERE z.rezept_key = p.rezept_key AND p.marke_key = $1
        AND u.marke_key = $1 AND u.fn_id = z.sub_rezept_fn_id
        AND u.fn_id = ANY($2::int[])
        AND z.sub_rezept_key IS DISTINCT FROM u.rezept_key`,
    [markeKey, fnIds])
}

/** rezept_key über (Marke, fn_id) — wirft, wenn das Rezept fehlt. */
async function rezeptKeyVon(c: PoolClient, markeKey: number, rezeptId: string | undefined): Promise<number> {
  if (!rezeptId) throw new Error('Rezeptposten ohne rezeptId im Parameter')
  const r = await c.query(
    `SELECT rezept_key FROM core.rezept WHERE marke_key = $1 AND fn_id = $2`, [markeKey, Number(rezeptId)])
  if (r.rows.length === 0) {
    // Zutaten und Meta entstehen aus einem Kopf (Liste oder fn:rezept) — fehlt
    // er, ist die Reihenfolge verletzt. Laut, nicht still.
    throw new Error(`Rezept ${rezeptId} (marke_key ${markeKey}) nicht in core.rezept`)
  }
  return Number(r.rows[0].rezept_key)
}
