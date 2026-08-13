/**
 * Ladenakte-Antworten in die Datenbank schreiben.
 *
 * Eine Transaktion je Posten: erst `raw.api_antwort`, dann `core`. Bricht
 * etwas ab, ist nichts halb geschrieben.
 *
 * DREI ZUSTÄNDE, DIE NICHT VERWECHSELT WERDEN DÜRFEN — sie sind der Grund für
 * die meisten Sonderfälle hier:
 *   keine Zeile   = dieser Betrieb wurde nicht abgerufen
 *   Zeile, NULL   = abgerufen, LINA hat nichts gebucht
 *   Zeile, 0,00   = abgerufen, gebucht, null Euro
 */
import type { PoolClient } from 'pg'
import { inTransaktion, inBloecken, mehrzeilig } from '../db/pool'
import { log } from '../lib/log'
import { bwaLongtermLesen, stammdatenLesen, monatsspalte, deutscheZahl } from './html'
import { SEITENGROESSE, ZAEHLGROESSE } from './endpunkte'

export type LaKontext = {
  ep: { key: string; pfad: string; form?: 'json' | 'html' }
  parameter: Record<string, string>
  daten: unknown
  httpStatus: number
  bytes: number
  hash: string
  laufId: string
}

/** Eine Zeile der DataTables-Antwort. Alle Felder sind optional — LINA lässt weg. */
type BelegRoh = Record<string, any>

/** Felder, die eine eigene Spalte haben. Alles andere wandert nach `zusatz`. */
const BEKANNTE_FELDER = new Set([
  'id', 'encryptedId', 'belegDatum', 'belegDatumTime', 'leistungsDatum', 'leistungsDatumTime',
  'reNumber', 'nettoBetrag', 'nettoBetragTax', 'taxItems', 'belegart', 'belegartName',
  'zuordnungFibu', 'zuordnungFibuName', 'seller_name', 'seller_id', 'kreditor_account',
  'cost_account', 'cost_account7', 'cost_account0', 'datev_guid', 'parashift_status',
  'parashift_id', 'uploadedBy', 'uploadedByName', 'uploadedOn', 'uploadedOnTime',
  'zuordnungMa', 'zuordnungMaName', 'downloadedOn', 'downloadedOnTime', 'uploadedFromArea',
  'archived', 'downloadFilename', 'extension', 'ownerInHof', 'ownerNotModifyable',
  'receiver_correct',
])

/** Unix-Sekunden in einen Zeitpunkt. 0 heisst „nie", nicht 1970. */
const ausUnix = (v: unknown): Date | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null
}

/** `DD.MM.YYYY` in ein Datum. Alles andere ist NULL, nicht heute. */
const ausDatum = (v: unknown): string | null => {
  const m = String(v ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

const leerZuNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s === '' || s === '-' ? null : s
}

/**
 * Kontonummern und Fremd-IDs. LINA schreibt „nicht zugeordnet" auf zwei Arten
 * in dasselbe Feld: als leere Zeichenkette und als Zahl 0 — im selben Ordner
 * gemischt (gemessen: 33-mal Text, 28-mal Zahl). Beides ist dasselbe und wird
 * NULL. Ein gespeichertes "0" waere ein Konto, das es nicht gibt, und jede
 * Gruppierung nach Kreditor haette dann einen erfundenen Sammelposten.
 */
const kontoZuNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s === '' || s === '0' || s === '-' ? null : s
}

/**
 * Obergrenze für einen Belegbetrag. Alles darüber ist `null`, nicht die Zahl.
 *
 * LINA liefert in `nettoBetrag` gelegentlich Cent mal 10^6. Nachgesehen in
 * `raw.api_antwort` am 12.08.2026: das Rohfeld enthält selbst
 * `"117982000000,00"`, wo die Steueraufteilung daneben `0,00/0,00/1.267,47`
 * sagt. `deutscheZahl` hat also korrekt gelesen, was ankam — der Fehler sitzt
 * in der Quelle, und dorthin reicht niemand von uns.
 *
 * DIE ZAHL WIRD NICHT KORRIGIERT, sondern verworfen. Durch 10^8 zu teilen
 * hiesse, einen Betrag zu erfinden: netto und Steuersumme stimmen auch dort
 * nicht überein, wo beide plausibel aussehen. Dieselbe Regel wie eine Zeile
 * tiefer — aus „unbekannt" darf kein Wert werden.
 *
 * 1 Mio EUR ist bewusst grosszügig: gemessen über 111.187 Rechnungen mit
 * Betrag liegt das 99. Perzentil bei 6.292 EUR, die grösste glaubhafte bei
 * 99.232 EUR. Getroffen werden 124 Belege, 105 davon über 100 Mio.
 * Migration 0058 hat die bereits geladenen auf NULL gesetzt.
 */
const BELEG_OBERGRENZE = 1_000_000

const belegBetrag = (roh: unknown): number | null => {
  const n = deutscheZahl(String(roh ?? ''))
  return n !== null && Math.abs(n) >= BELEG_OBERGRENZE ? null : n
}

/**
 * `zusatz` entsteht durch LÖSCHEN der bekannten Felder, nicht durch Aufzählen
 * der unbekannten. Damit ist jedes Feld, das LINA künftig hinzufügt, sofort in
 * der Datenbank statt still verloren — und `mart.buchungsbeleg_zusatzfelder`
 * zählt, was da auftaucht.
 */
function zusatzFelder(z: BelegRoh): Record<string, unknown> | null {
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(z)) if (!BEKANNTE_FELDER.has(k)) rest[k] = v
  return Object.keys(rest).length ? rest : null
}

// ---------------------------------------------------------------------------

export async function laLaden(k: LaKontext): Promise<number> {
  return inTransaktion(async c => {
    await c.query(
      `SELECT core.partition_anlegen('raw.api_antwort', d)
         FROM unnest(ARRAY[current_date, current_date + 1]) AS d`)

    const istHtml = (k.ep.form ?? 'json') === 'html'
    const linaBetriebId = Number(k.parameter.linaBetriebId)
    if (!Number.isInteger(linaBetriebId)) {
      throw new Error(`${k.ep.key}: linaBetriebId fehlt oder ist keine Zahl`)
    }

    /**
     * Roh ablegen. HTML nach `payload_text`, JSON nach `payload` — genau eine
     * der beiden Spalten ist gefüllt.
     *
     * Beim Stammdatenblatt wird das HTML VORHER bereinigt: eine seiner sieben
     * Tabellen führt die LINA-API-Schlüssel im Klartext, und `raw` ist
     * append-only. Was hier hineinkommt, bleibt drin.
     */
    const rohText = istHtml
      ? (k.ep.key === 'la:stammdaten' ? schluesseltabelleEntfernen(String(k.daten)) : String(k.daten))
      : null

    const roh = await c.query(
      `INSERT INTO raw.api_antwort
         (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, parameter,
          http_status, payload, payload_text, payload_hash, payload_bytes, lauf_id)
       VALUES ($1,$2,current_date,current_date,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, abgerufen_am`,
      [k.ep.key, null, JSON.stringify(k.parameter), k.httpStatus,
       istHtml ? null : JSON.stringify(k.daten), rohText,
       k.hash, k.bytes, k.laufId])
    const rawId = String(roh.rows[0].id)
    const abgerufenAm: Date = roh.rows[0].abgerufen_am

    const bk = await betriebKey(c, linaBetriebId)
    if (bk === null) {
      // Kein Fehler: die Ladenakte kennt 131 Gesellschaften, core.betrieb nur
      // die, die im Report Center vorkommen. Roh ist gesichert, also nichts verloren.
      log.warn('ladenakte: betrieb nicht in core.betrieb', { linaBetriebId, endpunkt: k.ep.key })
      return 0
    }

    switch (k.ep.key) {
      case 'la:belegzahl':    return belegzahlSchreiben(c, k, bk, linaBetriebId, rawId, abgerufenAm)
      case 'la:belegliste':   return belegeSchreiben(c, k, bk, linaBetriebId, rawId, abgerufenAm)
      case 'la:bwa_longterm': return bwaSchreiben(c, k, bk, rawId, abgerufenAm)
      case 'la:stammdaten':   return stammdatenSchreiben(c, k, bk, rawId, abgerufenAm)
      default:
        // Kein stiller default-Zweig: genau daran ist der Aktionsbericht einmal
        // vorbeigelaufen und hat monatelang nichts geschrieben.
        throw new Error(`laLaden: unbekannter Endpunkt "${k.ep.key}"`)
    }
  })
}

async function betriebKey(c: PoolClient, linaBetriebId: number): Promise<number | null> {
  const r = await c.query(
    `SELECT betrieb_key FROM core.betrieb WHERE lina_betrieb_id = $1`, [linaBetriebId])
  return r.rows.length ? Number(r.rows[0].betrieb_key) : null
}

/**
 * Die API-Schlüssel-Tabelle aus dem Stammdaten-HTML schneiden, bevor es in den
 * append-only Raw-Layer geht. Erkannt an ihrer Kopfzeile, nicht an ihrer
 * Position.
 */
export function schluesseltabelleEntfernen(html: string): string {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, t =>
    /API\s*-\s*Key/i.test(t)
      ? '<!-- Tabelle mit API-Schluesseln vor der Rohablage entfernt (AGENTS.md Regel 2) -->'
      : t)
}

// ---------------------------------------------------------------------------
// Zaehlung — der taegliche Abgleich, aus dem der Zulauf entsteht
// ---------------------------------------------------------------------------

/**
 * Eine Zaehlung schreiben und daraus entscheiden, ob der Ordner neu geholt wird.
 *
 * DIE INVARIANTE, GEGEN DIE HIER GEPRUEFT WIRD, IST NICHT "ist er gewachsen",
 * SONDERN "halten wir genau so viele, wie LINA zaehlt". Am 13.08.2026 in
 * Produktion nachgemessen: fuer alle 621 abgezogenen Ordner stimmten
 * `count(*)` aus `core.buchungsbeleg` und `records_total` auf den Beleg genau
 * ueberein, kein einziger Ausreisser. Das macht die Gleichheit zu einer
 * belastbaren Bedingung — und sie faengt drei Faelle, die ein blosses
 * "gewachsen?" durchliesse:
 *
 *   - ein Abzug, der mittendrin abgebrochen ist (wir haben weniger),
 *   - ein in LINA geloeschter Beleg (LINA hat weniger),
 *   - ein Ordner, der noch nie geholt wurde (wir haben null).
 *
 * DER FOLGEPOSTEN ENTSTEHT IN DERSELBEN TRANSAKTION wie die Zaehlung — wie bei
 * FoodNotify (`folgepostenEinreihen`). Bricht der Lauf dazwischen ab, ist
 * entweder beides geschrieben oder nichts; eine Zaehlung ohne ihren Abzug kann
 * es nicht geben.
 *
 * GESPERRT WIRD NUR EIN OFFENER POSTEN, nicht ein aufgegebener — anders als
 * `einreihenWennNeu()` in nachfuellen.ts. Der Unterschied ist beabsichtigt:
 * dort kannte niemand den Bedarf, hier ist er gemessen. Ein Ordner, dessen
 * Abzug gestern scheiterte, hat heute immer noch eine echte Luecke, und die
 * gehoert erneut versucht. Waechst die Warteschlange dadurch, dann um genau
 * die Ordner, die tatsaechlich fehlen — sichtbar in `mart.belegarchiv_zulauf`.
 */
async function belegzahlSchreiben(
  c: PoolClient, k: LaKontext, bk: number, linaBetriebId: number,
  rawId: string, abgerufenAm: Date,
): Promise<number> {
  const d = k.daten as { recordsTotal?: number; recordsFiltered?: number }
  const typId = String(k.parameter.typeId ?? '')
  if (!typId) throw new Error('la:belegzahl: typeId fehlt im Posten')

  /**
   * Ohne `recordsTotal` ist die Antwort wertlos — und gefaehrlich: sie als 0
   * zu lesen hiesse "der Ordner ist leer", und der Abgleich holte ihn nie
   * wieder. Werfen ist hier die einzige ehrliche Antwort.
   */
  const total = Number(d?.recordsTotal)
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(
      `la:belegzahl Betrieb ${linaBetriebId} Ordner ${typId}: recordsTotal fehlt oder ist `
      + `keine Zahl (${JSON.stringify(d?.recordsTotal)}). Eine Zaehlung ohne Zaehlstand ist `
      + `keine Zaehlung — als 0 gelesen hiesse sie "Ordner leer" und der Abgleich waere still.`)
  }

  await c.query(
    `INSERT INTO core.belegarchiv_bestand
       (betrieb_key, lina_betrieb_id, typ_id, gemessen_am, records_total,
        records_filtered, seitengroesse, archivierte_enthalten, raw_id, quelle)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,'zaehlung')`,
    [bk, linaBetriebId, typId, abgerufenAm, total,
     Number(d?.recordsFiltered ?? total), ZAEHLGROESSE, rawId])

  /**
   * Der Abzug wird nachgereiht, wenn Zaehlstand und Bestand auseinanderlaufen
   * UND die Belegart zum Holen freigegeben ist (`core.belegart.inhalt_holen`).
   *
   * Die Freigabe steht in der Datenbank und nicht hier im Code, weil sie eine
   * FACHLICHE Entscheidung ist: sechs der vierzehn Belegarten wurden nie
   * geholt (16, 3968, 3969, 3971, 3972, 3976), und ob sie geholt werden
   * sollen, entscheidet Eugene — Punkt 3 in docs/plan-datenvollstaendigkeit.md
   * Abschnitt 4. Gezaehlt werden sie ab sofort trotzdem: erst die Zaehlung
   * sagt, ob dort ueberhaupt etwas liegt, das die Entscheidung lohnt.
   *
   * Damit dieser Zweig nicht zu dem wird, wovor AGENTS.md warnt — ein "nichts
   * zu tun", das aussieht wie Erfolg — steht der Fall in
   * `mart.belegarchiv_zulauf` als eigene Zeile: gezaehlt, abweichend, nicht
   * freigegeben.
   */
  const nachgereiht = await c.query<{ posten_id: number }>(
    `WITH gehalten AS (
          SELECT count(*) AS n FROM core.buchungsbeleg
           WHERE betrieb_key = $1 AND typ_id = $2)
     INSERT INTO sync.warteschlange
       (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
     SELECT 'la:belegliste', $3::date, $3::date, $4, $5::jsonb
       FROM gehalten g, core.belegart a
      WHERE a.typ_id = $2 AND a.inhalt_holen
        AND g.n <> $6
        AND NOT EXISTS (SELECT 1 FROM sync.warteschlange w
                         WHERE w.endpunkt = 'la:belegliste'
                           AND w.parameter = $5::jsonb
                           AND w.erledigt_am IS NULL)
     RETURNING posten_id`,
    [bk, typId, abgerufenAm.toISOString().slice(0, 10), PRIORITAET_ABZUG,
     JSON.stringify({ linaBetriebId: String(linaBetriebId), typeId: typId }), total])

  if (nachgereiht.rows.length > 0) {
    log.info('belegarchiv: abweichung gezaehlt, abzug nachgereiht', {
      linaBetriebId, typ_id: typId, records_total: total,
    })
  }

  // Eine Zaehlung ist eine Zeile — nicht `total`. Sonst zeigte sync.aufgabe
  // fuer diesen Posten 8.384 geladene Zeilen, wo eine Zahl geholt wurde.
  return 1
}

/**
 * Der nachgereihte Abzug laeuft VOR den uebrigen Ladenakte-Posten (95), aber
 * hinter LINAs Tagesdaten. Er ist die Reparatur einer gemessenen Luecke; die
 * Zaehlungen, die ihn ausgeloest haben, duerfen ihm nicht den Rang ablaufen.
 */
const PRIORITAET_ABZUG = 93

// ---------------------------------------------------------------------------
// Belege
// ---------------------------------------------------------------------------

async function belegeSchreiben(
  c: PoolClient, k: LaKontext, bk: number, linaBetriebId: number,
  rawId: string, abgerufenAm: Date,
): Promise<number> {
  const d = k.daten as { data?: BelegRoh[]; recordsTotal?: number; recordsFiltered?: number }
  const zeilen = d?.data ?? []
  const total = Number(d?.recordsTotal ?? -1)
  const typId = String(k.parameter.typeId ?? '')
  if (!typId) throw new Error('la:belegliste: typeId fehlt im Posten')

  /**
   * Die einzige Zusicherung auf Vollständigkeit, die es gibt. Ohne diese
   * Prüfung sähe eine stillschweigend gekürzte Antwort aus wie ein kleiner
   * Ordner — und niemand würde je erfahren, dass Belege fehlen.
   */
  if (total >= 0 && zeilen.length !== total) {
    throw new Error(
      `la:belegliste Betrieb ${linaBetriebId} Ordner ${typId}: ${zeilen.length} Zeilen `
      + `geliefert, recordsTotal sagt ${total}. Angefordert waren ${SEITENGROESSE}. `
      + `Entweder deckelt LINA jetzt doch, oder die Antwort ist unvollstaendig.`)
  }

  /**
   * Der Bestand VOR dem Upsert — der Nenner der Schwundrechnung weiter unten.
   * Nach dem Upsert wäre er verfälscht, weil neue Belege schon mitzählen.
   */
  const vorher = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.buchungsbeleg
      WHERE betrieb_key = $1 AND typ_id = $2`, [bk, typId])
  const gehaltenVorher = Number(vorher.rows[0].n)

  await c.query(
    `INSERT INTO core.belegarchiv_bestand
       (betrieb_key, lina_betrieb_id, typ_id, gemessen_am, records_total,
        records_filtered, seitengroesse, archivierte_enthalten, raw_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8)`,
    [bk, linaBetriebId, typId, abgerufenAm, total,
     Number(d?.recordsFiltered ?? total), SEITENGROESSE, rawId])

  if (zeilen.length === 0) {
    // NICHT hier aussteigen, ohne aufgeräumt zu haben: ein leer gewordener
    // Ordner ist der extremste Schwundfall, und genau der muss auffallen.
    await verschwundeneEntfernen(c, bk, typId, [], gehaltenVorher, linaBetriebId, total)
    return 0
  }

  // Kein stiller Verlust: was belegBetrag verwirft, steht im Log. Sonst sieht
  // ein Lauf mit lauter unlesbaren Betraegen genauso aus wie ein sauberer.
  const verworfen = zeilen.filter(z =>
    deutscheZahl(String(z.nettoBetrag ?? '')) !== null &&
    belegBetrag(z.nettoBetrag) === null).length
  if (verworfen > 0) {
    log.warn('unglaubhafte Belegbetraege verworfen', {
      betrieb_key: bk, typ_id: typId, anzahl: verworfen,
      grenze: BELEG_OBERGRENZE,
      hinweis: 'LINA liefert nettoBetrag teils als Cent mal 10^6, siehe 0058',
    })
  }

  const spalten = [
    'betrieb_key', 'lina_betrieb_id', 'typ_id', 'lina_id', 'encrypted_id',
    'beleg_datum', 'leistungs_datum', 're_nummer', 'netto', 'netto_split_roh',
    'belegart_roh', 'belegart_name', 'zuordnung_fibu', 'verkaeufer_name', 'verkaeufer_id',
    'kreditor_konto', 'sachkonto', 'sachkonto_7', 'sachkonto_0', 'datev_guid',
    'parashift_status', 'parashift_id', 'hochgeladen_von_hash', 'hochgeladen_von_name',
    'hochgeladen_am', 'zuordnung_ma', 'zuordnung_ma_name', 'heruntergeladen_am',
    'hochgeladen_aus_bereich', 'archiviert', 'datei_name', 'dateiendung', 'zusatz', 'raw_id',
  ]

  let geschrieben = 0
  await inBloecken(zeilen, 500, async block => {
    const { platzhalter, werte } = mehrzeilig(spalten, block.map(z => ({
      betrieb_key: bk,
      lina_betrieb_id: linaBetriebId,
      typ_id: typId,
      lina_id: String(z.id ?? ''),
      encrypted_id: leerZuNull(z.encryptedId),
      beleg_datum: ausDatum(z.belegDatum),
      leistungs_datum: ausDatum(z.leistungsDatum),
      re_nummer: leerZuNull(z.reNumber),
      // Bei unlesbarem Betrag NULL, nicht 0 — sonst wird aus „unbekannt" ein Wert.
      // Das gilt auch für lesbare, aber unglaubhafte Zahlen, siehe belegBetrag.
      netto: belegBetrag(z.nettoBetrag),
      netto_split_roh: leerZuNull(z.nettoBetragTax),
      belegart_roh: z.belegart == null ? null : String(z.belegart),
      belegart_name: leerZuNull(z.belegartName),
      zuordnung_fibu: z.zuordnungFibu == null ? null : Number(z.zuordnungFibu),
      verkaeufer_name: leerZuNull(z.seller_name),
      verkaeufer_id: kontoZuNull(z.seller_id),
      kreditor_konto: kontoZuNull(z.kreditor_account),
      sachkonto: kontoZuNull(z.cost_account),
      sachkonto_7: kontoZuNull(z.cost_account7),
      sachkonto_0: kontoZuNull(z.cost_account0),
      datev_guid: leerZuNull(z.datev_guid),
      parashift_status: leerZuNull(z.parashift_status),
      parashift_id: leerZuNull(z.parashift_id),
      hochgeladen_von_hash: leerZuNull(z.uploadedBy),
      hochgeladen_von_name: leerZuNull(z.uploadedByName),
      hochgeladen_am: ausUnix(z.uploadedOnTime),
      zuordnung_ma: leerZuNull(z.zuordnungMa),
      zuordnung_ma_name: leerZuNull(z.zuordnungMaName),
      heruntergeladen_am: ausUnix(z.downloadedOnTime),
      hochgeladen_aus_bereich: leerZuNull(z.uploadedFromArea),
      archiviert: String(z.archived ?? '0') === '1',
      datei_name: leerZuNull(z.downloadFilename),
      dateiendung: leerZuNull(z.extension),
      zusatz: JSON.stringify(zusatzFelder(z) ?? {}),
      raw_id: rawId,
    })))

    const r = await c.query(
      `INSERT INTO core.buchungsbeleg (${spalten.join(', ')}) VALUES ${platzhalter}
       ON CONFLICT (betrieb_key, lina_id) DO UPDATE SET
         typ_id = EXCLUDED.typ_id,
         encrypted_id = EXCLUDED.encrypted_id,
         beleg_datum = EXCLUDED.beleg_datum,
         netto = EXCLUDED.netto,
         zuordnung_fibu = EXCLUDED.zuordnung_fibu,
         sachkonto = EXCLUDED.sachkonto,
         archiviert = EXCLUDED.archiviert,
         zusatz = EXCLUDED.zusatz,
         raw_id = EXCLUDED.raw_id,
         zuletzt_am = now()`, werte)
    geschrieben += r.rowCount ?? 0
  })

  // Steuerzeilen: taxItems {"0":..,"7":..,"19":..} lang abgelegt.
  await steuerSchreiben(c, bk, zeilen)

  await verschwundeneEntfernen(
    c, bk, typId, zeilen.map(z => String(z.id ?? '')),
    gehaltenVorher, linaBetriebId, total)

  return geschrieben
}

/**
 * Wie viel eines Ordners in EINER Nacht verschwinden darf, bevor der Abzug
 * lieber wirft als loescht.
 *
 * BEIDE Schranken muessen gerissen sein — Anteil UND absolute Zahl. Der
 * Anteil allein waere bei kleinen Ordnern eine Dauerwarnung: gemessen am
 * 13.08.2026 in Produktion fuehrt Belegart 3970 (Lieferscheine) 17 Ordner mit
 * zusammen 542 Belegen, im Schnitt 32 Stueck. Dort ist EIN geloeschter Beleg
 * schon mehr als 3 %, bei zehn Belegen im Ordner sind es 10 % — und LINA
 * loescht nun einmal gelegentlich einen Beleg. Die absolute Zahl allein waere
 * umgekehrt bei den grossen Ordnern blind: der groesste freigegebene haelt
 * 12.668 Belege, dort sind zwanzig verschwundene Belege nichts.
 *
 * Was die Schranke abfangen soll, ist nicht die Pflege, sondern der Ausfall:
 * LINA raeumt einen Ordner ab, oder die Antwort war trotz `recordsTotal`
 * unvollstaendig. Beides sieht nach dem Loeschen aus wie ein kleiner Ordner —
 * lautlos und plausibel, genau die Signatur, an der dieses Projekt schon
 * zweimal Tage verloren hat.
 */
const SCHWUND_ANTEIL = 0.05
const SCHWUND_MINDESTZAHL = 10

/**
 * Belege loeschen, die LINA nicht mehr fuehrt.
 *
 * WARUM DAS SEIN MUSS. `belegeSchreiben()` war bis zum 13.08.2026 ein reiner
 * Upsert: ein in LINA geloeschter Beleg blieb bei uns fuer immer stehen. Der
 * Zulaufabgleich aus 0069 prueft aber auf GLEICHHEIT (`gehalten <> gezaehlt`),
 * und zwar bewusst — nur so faengt er auch den abgebrochenen Abzug. Ab dem
 * ersten geloeschten Beleg galt damit dauerhaft `gehalten > gezaehlt`, der
 * Lauf holte den vollen Ordner jede Nacht neu (bis zu 12.668 Belege), und
 * nichts aenderte sich je. Der Zustand pendelte zwischen "abzug eingereiht"
 * und "abzug fehlt" — Letzteres sagte dabei das Falsche: der Abzug fehlte
 * nicht, er war wirkungslos.
 *
 * WARUM DAS SICHER IST. Die Antwort IST der vollstaendige Ordner: `length`
 * ist 100.000, und die Pruefung `zeilen.length === recordsTotal` eine Zeile
 * weiter oben laesst nichts anderes durch. Archivierte Belege stehen mit in
 * der Liste (Feld `archived` kommt in den Zeilen mit) und werden deshalb
 * nicht faelschlich geloescht — der Beweis ist die am 13.08.2026 gemessene
 * Gleichheit ueber alle abgezogenen Ordner. `core.buchungsbeleg_steuer`
 * haengt per ON DELETE CASCADE dran (0053), es bleibt nichts verwaist.
 * Dieselbe Logik traegt schon `core.bestellposition` und
 * `core.inventurposition`: ersetzen statt ewig anhaeufen.
 *
 * OHNE recordsTotal WIRD NICHTS GELOESCHT. Dann ist die Vollstaendigkeit
 * ungeprueft, und aus "unbekannt" darf kein Loeschbefehl werden.
 *
 * EIN BELEG, DER DEN ORDNER WECHSELT, geht nicht verloren: der Upsert-
 * Schluessel ist (betrieb_key, lina_id) ohne typ_id (0053, Falle 5). Zieht
 * der neue Ordner zuerst ab, steht der Beleg schon auf der neuen typ_id und
 * die Loeschbedingung des alten trifft ihn nicht mehr. Zieht der alte zuerst
 * ab, loescht er ihn, und der Abzug des neuen schreibt ihn wieder — dessen
 * Zaehlung reiht ihn nach. Spaetestens in der zweiten Nacht steht er richtig.
 *
 * GEWORFEN WIRD IN DERSELBEN TRANSAKTION wie geloescht. "Nichts geloescht"
 * ist deshalb keine Zusage des Codes, sondern die Folge des Ruecklaufs.
 */
async function verschwundeneEntfernen(
  c: PoolClient, bk: number, typId: string, gelieferteIds: string[],
  gehaltenVorher: number, linaBetriebId: number, total: number,
): Promise<void> {
  if (total < 0) return
  if (gehaltenVorher === 0) return

  const weg = await c.query<{ lina_id: string }>(
    `DELETE FROM core.buchungsbeleg b
      WHERE b.betrieb_key = $1 AND b.typ_id = $2
        AND NOT EXISTS (SELECT 1 FROM unnest($3::text[]) AS g(lina_id)
                         WHERE g.lina_id = b.lina_id)
      RETURNING b.lina_id`,
    [bk, typId, gelieferteIds])
  if (weg.rowCount === 0) return

  const anzahl = weg.rowCount ?? 0
  const anteil = anzahl / gehaltenVorher
  if (anzahl > SCHWUND_MINDESTZAHL && anteil > SCHWUND_ANTEIL) {
    throw new Error(
      `la:belegliste Betrieb ${linaBetriebId} Ordner ${typId}: ${anzahl} von `
      + `${gehaltenVorher} Belegen stehen nicht mehr in LINAs Liste `
      + `(${(anteil * 100).toFixed(1)} %, recordsTotal ${total}). Ueber `
      + `${(SCHWUND_ANTEIL * 100).toFixed(0)} % und mehr als ${SCHWUND_MINDESTZAHL} Stueck `
      + `ist das keine Pflege mehr, sondern ein Befund — entweder raeumt LINA den `
      + `Ordner ab, oder die Antwort war trotz recordsTotal unvollstaendig. `
      + `Es wird nichts geloescht; der Posten steht in mart.posten_aufgegeben, `
      + `sobald die Versuche aufgebraucht sind.`)
  }

  // Unterhalb der Schwelle ist es Pflege — aber nicht lautlos: eine Loeschung
  // ist die einzige Stelle, an der uns Daten absichtlich abhandenkommen.
  log.info('belegarchiv: in LINA geloeschte Belege entfernt', {
    linaBetriebId, typ_id: typId, geloescht: anzahl,
    gehalten_vorher: gehaltenVorher, anteil_pct: Number((anteil * 100).toFixed(2)),
  })
}

async function steuerSchreiben(
  c: PoolClient, bk: number, zeilen: BelegRoh[],
): Promise<void> {
  const paare: { lina_id: string; satz: number; betrag: number }[] = []
  for (const z of zeilen) {
    const t = z.taxItems
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    for (const [satz, betrag] of Object.entries(t)) {
      const s = Number(satz)
      const b = typeof betrag === 'number' ? betrag : deutscheZahl(String(betrag ?? ''))
      if (!Number.isFinite(s) || b === null) continue
      paare.push({ lina_id: String(z.id ?? ''), satz: s, betrag: b })
    }
  }
  if (paare.length === 0) return

  await inBloecken(paare, 500, async block => {
    const { platzhalter, werte } = mehrzeilig(
      ['lina_id', 'satz', 'betrag'],
      block.map(x => ({ lina_id: x.lina_id, satz: String(x.satz), betrag: String(x.betrag) })))
    await c.query(
      `INSERT INTO core.buchungsbeleg_steuer (buchungsbeleg_key, satz, betrag)
       -- Casten: die VALUES-Liste kommt als text an, die Zielspalten sind numeric.
       SELECT b.buchungsbeleg_key, v.satz::numeric(5,2), v.betrag::numeric(14,2)
         FROM (VALUES ${platzhalter}) AS v(lina_id, satz, betrag)
         JOIN core.buchungsbeleg b
           ON b.betrieb_key = $${werte.length + 1}
          AND b.lina_id = v.lina_id
       ON CONFLICT (buchungsbeleg_key, satz) DO UPDATE SET betrag = EXCLUDED.betrag`,
      [...werte, bk])
  })
}

// ---------------------------------------------------------------------------
// BWA
// ---------------------------------------------------------------------------

async function bwaSchreiben(
  c: PoolClient, k: LaKontext, bk: number, rawId: string, abgerufenAm: Date,
): Promise<number> {
  const b = bwaLongtermLesen(String(k.daten))

  /**
   * Struktur ohne Werte ist der Normalfall einer Holding, kein Fehler. Der
   * Franchisegeber liefert 80 Monatsspalten und keine einzige Zahl. Würde hier
   * geschrieben, entstünden 6.160 Nullzeilen, die aussehen wie gebuchte Nullen.
   */
  if (b.zellenMitWert === 0) {
    log.info('bwa longterm ohne Werte — nichts geschrieben', {
      betriebKey: bk, monate: b.monate.length, zeilen: b.zeilen.length })
    return 0
  }

  // Je Betrieb löschen und neu schreiben: LINA bucht rückwirkend nach, und ein
  // reiner Upsert liesse eine gelöschte Zeile für immer stehen.
  await c.query(`DELETE FROM core.bwa_position WHERE betrieb_key = $1`, [bk])

  const reihen: any[] = []
  b.monate.forEach((m, i) => {
    const monat = monatsspalte(m)
    for (const z of b.zeilen) {
      reihen.push({
        betrieb_key: bk, monat, zeile: z.bezeichnung, zeile_id: String(z.zeileId),
        zeile_nr: z.ebene ?? null, betrag: z.werte[i], abgerufen_am: abgerufenAm, raw_id: rawId,
      })
    }
  })

  const spalten = ['betrieb_key', 'monat', 'zeile', 'zeile_id', 'zeile_nr',
                   'betrag', 'abgerufen_am', 'raw_id']
  let n = 0
  await inBloecken(reihen, 1000, async block => {
    const { platzhalter, werte } = mehrzeilig(spalten, block)
    const r = await c.query(
      `INSERT INTO core.bwa_position (${spalten.join(', ')}) VALUES ${platzhalter}
       ON CONFLICT (betrieb_key, monat, zeile) DO NOTHING`, werte)
    n += r.rowCount ?? 0
  })
  return n
}

// ---------------------------------------------------------------------------
// Stammdaten
// ---------------------------------------------------------------------------

async function stammdatenSchreiben(
  c: PoolClient, k: LaKontext, bk: number, rawId: string, abgerufenAm: Date,
): Promise<number> {
  const s = stammdatenLesen(String(k.daten))
  const monat = new Date(abgerufenAm.getFullYear(), abgerufenAm.getMonth(), 1)
    .toISOString().slice(0, 10)
  let n = 0

  // Kapazität: Momentaufnahme je Monat. Schlüssel ist die ZEILENNUMMER, nicht
  // der Bereichsname — „Umsatz 19%" zeigt, wie ungepflegt die Namen sind, und
  // zwei gleich benannte Zeilen würden sich beim Upsert gegenseitig löschen.
  if (s.kapazitaet.length) {
    const sp = ['betrieb_key', 'monat', 'zeile_nr', 'bereich', 'ist_gesamt',
                'plaetze', 'tische', 'flaeche_qm', 'abgerufen_am', 'raw_id']
    const { platzhalter, werte } = mehrzeilig(sp, s.kapazitaet.map((x, i) => ({
      betrieb_key: bk, monat, zeile_nr: i, bereich: x.bereich,
      ist_gesamt: /^gesamt$/i.test(x.bereich),
      plaetze: x.plaetze, tische: x.tische, flaeche_qm: x.flaecheQm,
      abgerufen_am: abgerufenAm, raw_id: rawId,
    })))
    const r = await c.query(
      `INSERT INTO core.betrieb_kapazitaet (${sp.join(', ')}) VALUES ${platzhalter}
       ON CONFLICT (betrieb_key, monat, zeile_nr) DO UPDATE SET
         bereich = EXCLUDED.bereich, ist_gesamt = EXCLUDED.ist_gesamt,
         plaetze = EXCLUDED.plaetze, tische = EXCLUDED.tische,
         flaeche_qm = EXCLUDED.flaeche_qm, abgerufen_am = EXCLUDED.abgerufen_am,
         raw_id = EXCLUDED.raw_id`, werte)
    n += r.rowCount ?? 0
  }

  // Plan-BWA
  const planReihen = s.planBwa.flatMap(z => z.werte.map(w => ({
    betrieb_key: bk, monat: w.monat, zeile: z.bezeichnung, zeile_id: String(z.zeileId),
    zeile_nr: null, betrag: w.betrag, abgerufen_am: abgerufenAm, raw_id: rawId,
  })))
  if (planReihen.length) {
    const sp = ['betrieb_key', 'monat', 'zeile', 'zeile_id', 'zeile_nr',
                'betrag', 'abgerufen_am', 'raw_id']
    await inBloecken(planReihen, 1000, async block => {
      const { platzhalter, werte } = mehrzeilig(sp, block)
      const r = await c.query(
        `INSERT INTO core.bwa_plan (${sp.join(', ')}) VALUES ${platzhalter}
         ON CONFLICT (betrieb_key, monat, zeile) DO UPDATE SET
           betrag = EXCLUDED.betrag, zeile_id = EXCLUDED.zeile_id,
           abgerufen_am = EXCLUDED.abgerufen_am, raw_id = EXCLUDED.raw_id`, werte)
      n += r.rowCount ?? 0
    })
  }

  // Tagesbudget
  if (s.tagesbudget.length) {
    const sp = ['betrieb_key', 'datum', 'umsatz_netto', 'stunden_service',
                'stunden_bar', 'stunden_kueche', 'abgerufen_am', 'raw_id']
    await inBloecken(s.tagesbudget, 500, async block => {
      const { platzhalter, werte } = mehrzeilig(sp, block.map(t => ({
        betrieb_key: bk, datum: t.datum, umsatz_netto: t.umsatzNetto,
        stunden_service: t.stundenService, stunden_bar: t.stundenBar,
        stunden_kueche: t.stundenKueche, abgerufen_am: abgerufenAm, raw_id: rawId,
      })))
      const r = await c.query(
        `INSERT INTO core.tagesbudget (${sp.join(', ')}) VALUES ${platzhalter}
         ON CONFLICT (betrieb_key, datum) DO UPDATE SET
           umsatz_netto = EXCLUDED.umsatz_netto,
           stunden_service = EXCLUDED.stunden_service,
           stunden_bar = EXCLUDED.stunden_bar,
           stunden_kueche = EXCLUDED.stunden_kueche,
           abgerufen_am = EXCLUDED.abgerufen_am, raw_id = EXCLUDED.raw_id`, werte)
      n += r.rowCount ?? 0
    })
  }

  return n
}
