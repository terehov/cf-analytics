/**
 * Yext Analytics nach core.bewertung_thema und drei Nachbartabellen.
 *
 * DER GEGENENTWURF ZU laden.ts. Dort ist ein Aufruf eine Zahl fuer einen
 * Betrieb, einen Monat und ein Portal -- der Backfill kostet 3.300
 * Aufrufe, und jede Schleife dort dient dem einen Zweck, Aufrufe zu
 * sparen. Hier liefert EIN Aufruf alle Betriebe ueber alle Monate
 * (gemessen: 790 Zeilen). Deshalb gibt es hier keine Abkuerzungen, kein
 * inkrementelles Laden und keinen Rueckgriff: der volle Zeitraum kostet
 * sechs Aufrufe, ein kluger Teilzeitraum auch.
 *
 * WAS NICHT GEHOLT WIRD, obwohl es da waere (Begruendung im Einzelnen in
 * docs/yext-analytics-inventar.md §5 und §11 C):
 *
 *   KEYWORD_SENTIMENT  -- 4.362 von 5.119 Stichworten stehen auf exakt 0,
 *                         darunter essen, bedienung, personal. Die NOTE
 *                         trennt dieselben Themen von 2,50 bis 4,35.
 *   REVIEW_TOPICS      -- ungefilterte n-Gramme, die Spitze sind deutsche
 *                         Stoppwoerter ("ein" 725 mal). Ohne
 *                         Stoppwortliste und Schwelle unbrauchbar.
 *   REVIEW_CONTENT     -- die Bewertungstexte noch einmal, diesmal als
 *                         Gruppierungsschluessel. Wir haben sie in
 *                         core.bewertung, begruendet und begrenzt
 *                         (Migration 0037). Ein zweiter Weg dorthin waere
 *                         ein Umweg um die eigene Entscheidung.
 */
import { query } from '../db/pool'
import { log } from '../lib/log'
import { bericht, datenstand, zahl, text, type BerichtZeile, type BerichtFilter } from './client'
import { zuordnungen, type Monat, monate } from './laden'

export type AnalyticsErgebnis = {
  aufrufe: number
  themen: number
  antworten: number
  noten: number
  sichtbarkeit: number
  metriken: number
}

/** Der Zeitraum als Filter -- Yext will Kalendertage, nicht Monatserste. */
function fenster(monateAnzahl: number): { startDate: string; endDate: string; ab: string } {
  const f: Monat[] = monate(monateAnzahl)
  const ab = f.at(-1)!.erster
  return { startDate: ab, endDate: new Date().toISOString().slice(0, 10), ab }
}

/** ENTITY_IDS -> betrieb_key, fuer alle vier Bloecke dieselbe Abbildung. */
type Karte = Map<string, number>

/**
 * Yext liefert den Monat als 'YYYY-MM-DD' (Monatserster). Zeilen ohne
 * Monat oder ohne bekannte Entitaet werden verworfen -- sie liessen sich
 * keinem Betrieb zuordnen und waeren in jeder Auswertung ein stiller
 * Ausreisser. Die Zahl der verworfenen Zeilen wird gemeldet.
 */
function schluessel(z: BerichtZeile, k: Karte): { betrieb: number; monat: string } | null {
  const id = text(z, 'ENTITY_IDS')
  const monat = text(z, 'MONTHS')
  if (!id || !monat) return null
  const betrieb = k.get(id)
  if (betrieb === undefined) return null
  return { betrieb, monat }
}

// ---------------------------------------------------------------------
// Die Klusterung
// ---------------------------------------------------------------------
async function themenLaden(k: Karte, ids: string[], f: ReturnType<typeof fenster>) {
  const zeilen = await bericht(
    ['NEW_REVIEWS', 'AVERAGE_RATING'],
    ['REVIEW_LABELS', 'ENTITY_IDS', 'MONTHS'],
    { entityIds: ids, startDate: f.startDate, endDate: f.endDate })

  const raus: { b: number; m: string; t: string; n: number; s: number | null }[] = []
  for (const z of zeilen) {
    const s = schluessel(z, k)
    const thema = text(z, 'REVIEW_LABELS')
    const anzahl = zahl(z, 'NEW_REVIEWS')
    if (!s || !thema || anzahl === null) continue
    const note = zahl(z, 'AVERAGE_RATING')
    // Yext liefert 0 fuer "keine Note" (Portale ohne Sternewertung). Eine
    // 0 in einer 1-bis-5-Skala waere eine Aussage, die niemand gemacht hat.
    raus.push({ b: s.betrieb, m: s.monat, t: thema, n: anzahl, s: note && note > 0 ? note : null })
  }
  if (raus.length) {
    await query(
      `INSERT INTO core.bewertung_thema (betrieb_key, monat, thema, anzahl, schnitt, geladen_am)
       SELECT b, m::date, t, n, s, now()
         FROM unnest($1::int[], $2::text[], $3::text[], $4::int[], $5::numeric[])
              AS x(b, m, t, n, s)
       ON CONFLICT (betrieb_key, monat, thema) DO UPDATE SET
           anzahl = excluded.anzahl, schnitt = excluded.schnitt, geladen_am = now()`,
      [raus.map(x => x.b), raus.map(x => x.m), raus.map(x => x.t),
       raus.map(x => x.n), raus.map(x => x.s)])
  }
  return raus.length
}

// ---------------------------------------------------------------------
// Antwortverhalten -- drei Berichte, eine Zeile
//
// Getrennt geholt, weil AWAITING_RESPONSE die Zeilen aufspaltet: mit
// dieser Dimension stuende jede Bewertungszahl zweimal da (offen / nicht
// offen), und die Quote daneben waere doppelt gezaehlt.
// ---------------------------------------------------------------------
async function antwortLaden(k: Karte, ids: string[], f: ReturnType<typeof fenster>) {
  type Zeile = {
    bewertungen: number; antworten: number | null; quote: number | null
    stunden: number | null; offen: number | null; offen_schlecht: number | null
  }
  const tabelle = new Map<string, Zeile>()
  const holen = (b: number, m: string): Zeile => {
    const s = `${b}|${m}`
    let z = tabelle.get(s)
    if (!z) {
      z = { bewertungen: 0, antworten: null, quote: null, stunden: null, offen: null, offen_schlecht: null }
      tabelle.set(s, z)
    }
    return z
  }

  const grund = await bericht(
    ['NEW_REVIEWS', 'RESPONSE_COUNT', 'RESPONSE_RATE', 'REVIEW_RESPONSE_TIME_REVIEW_TIMESTAMP_BASED'],
    ['ENTITY_IDS', 'MONTHS'],
    { entityIds: ids, startDate: f.startDate, endDate: f.endDate })
  for (const z of grund) {
    const s = schluessel(z, k)
    if (!s) continue
    const r = holen(s.betrieb, s.monat)
    r.bewertungen = zahl(z, 'NEW_REVIEWS') ?? 0
    r.antworten = zahl(z, 'RESPONSE_COUNT')
    r.quote = zahl(z, 'RESPONSE_RATE')
    const stunden = zahl(z, 'REVIEW_RESPONSE_TIME_REVIEW_TIMESTAMP_BASED')
    // Wer NICHT geantwortet hat, hat keine Reaktionszeit -- Yext liefert
    // dafuer 0, und 0 Stunden liest sich als "sofort geantwortet". Genau
    // die Betriebe, die gar nicht antworten, staenden damit an der Spitze
    // der Bestenliste (gemessen: 100 solcher Zeilen im ersten Lauf).
    r.stunden = r.antworten ? stunden : null
    // Kein offener Fall ist eine 0, keine Leerstelle. Yext liefert fuer
    // AWAITING_RESPONSE=TRUE gar keine Zeile, wenn nichts offen ist; ohne
    // diese Vorbelegung stuende NULL da, und eine Sortierung nach
    // "offene Faelle" haette die sauberen Betriebe ans Ende gesetzt.
    r.offen = 0
    r.offen_schlecht = 0
  }

  // Zweimal dieselbe Abfrage, einmal auf 1-2 Sterne eingegrenzt: die
  // Gesamtzahl offener Faelle sagt, wie viel Arbeit liegen blieb, die
  // schlechten sagen, welche davon weh tut.
  const bloecke: ['offen' | 'offen_schlecht', BerichtFilter][] = [
    ['offen', {}],
    ['offen_schlecht', { ratings: [1, 2] }],
  ]
  for (const [feld, filter] of bloecke) {
    const zeilen = await bericht(['NEW_REVIEWS'], ['ENTITY_IDS', 'MONTHS', 'AWAITING_RESPONSE'],
      { entityIds: ids, startDate: f.startDate, endDate: f.endDate, ...filter })
    for (const z of zeilen) {
      const s = schluessel(z, k)
      if (!s || text(z, 'AWAITING_RESPONSE') !== 'TRUE') continue
      holen(s.betrieb, s.monat)[feld] = zahl(z, 'NEW_REVIEWS')
    }
  }

  const raus = [...tabelle].map(([s, z]) => {
    const [b, m] = s.split('|')
    return { b: Number(b), m: m!, ...z }
  })
  if (raus.length) {
    await query(
      `INSERT INTO core.bewertung_antwort
         (betrieb_key, monat, bewertungen, antworten, quote, reaktion_stunden,
          offen, offen_schlecht, geladen_am)
       SELECT b, m::date, bw, an, q, st, o, os, now()
         FROM unnest($1::int[], $2::text[], $3::int[], $4::int[], $5::numeric[],
                     $6::numeric[], $7::int[], $8::int[])
              AS x(b, m, bw, an, q, st, o, os)
       ON CONFLICT (betrieb_key, monat) DO UPDATE SET
           bewertungen = excluded.bewertungen, antworten = excluded.antworten,
           quote = excluded.quote, reaktion_stunden = excluded.reaktion_stunden,
           offen = excluded.offen, offen_schlecht = excluded.offen_schlecht,
           geladen_am = now()`,
      [raus.map(x => x.b), raus.map(x => x.m), raus.map(x => x.bewertungen),
       raus.map(x => x.antworten), raus.map(x => x.quote), raus.map(x => x.stunden),
       raus.map(x => x.offen), raus.map(x => x.offen_schlecht)])
  }
  return raus.length
}

// ---------------------------------------------------------------------
// Notenverteilung
// ---------------------------------------------------------------------
async function notenLaden(k: Karte, ids: string[], f: ReturnType<typeof fenster>) {
  const zeilen = await bericht(['NEW_REVIEWS'], ['ENTITY_IDS', 'MONTHS', 'RATINGS'],
    { entityIds: ids, startDate: f.startDate, endDate: f.endDate })

  const raus: { b: number; m: string; n: number; a: number }[] = []
  for (const z of zeilen) {
    const s = schluessel(z, k)
    const note = Number(text(z, 'RATINGS'))
    const anzahl = zahl(z, 'NEW_REVIEWS')
    // Yext fuehrt auch eine Gruppe "0" -- Bewertungen ohne Sternewertung
    // (Facebook, Foursquare). Die Tabelle laesst nur 1 bis 5 zu, und das
    // ist richtig: eine Null ist keine schlechte Note, sondern keine.
    if (!s || anzahl === null || !Number.isInteger(note) || note < 1 || note > 5) continue
    raus.push({ b: s.betrieb, m: s.monat, n: note, a: anzahl })
  }
  if (raus.length) {
    await query(
      `INSERT INTO core.bewertung_note (betrieb_key, monat, note, anzahl, geladen_am)
       SELECT b, m::date, n, a, now()
         FROM unnest($1::int[], $2::text[], $3::smallint[], $4::int[]) AS x(b, m, n, a)
       ON CONFLICT (betrieb_key, monat, note) DO UPDATE SET
           anzahl = excluded.anzahl, geladen_am = now()`,
      [raus.map(x => x.b), raus.map(x => x.m), raus.map(x => x.n), raus.map(x => x.a)])
  }
  return raus.length
}

// ---------------------------------------------------------------------
// Sichtbarkeit und Pflegezustand -- genau zehn Metriken, das Maximum
// ---------------------------------------------------------------------
async function sichtbarkeitLaden(k: Karte, ids: string[], f: ReturnType<typeof fenster>) {
  const zeilen = await bericht(
    ['TOTAL_LISTINGS_IMPRESSIONS', 'GOOGLE_LISTINGS_IMPRESSIONS',
     'GOOGLE_LISTINGS_IMPRESSIONS_BENCHMARK_MEDIAN', 'SEARCHES', 'PROFILE_VIEWS',
     'CLICK_COUNT', 'LISTINGS_ACCURACY', 'POWERLISTINGS_LIVE',
     'UNAVAILABLE_REASON_COUNT', 'PUBLISHER_SUGGESTIONS'],
    ['ENTITY_IDS', 'MONTHS'],
    { entityIds: ids, startDate: f.startDate, endDate: f.endDate })

  const ganz = (v: number | null) => (v === null ? null : Math.round(v))
  const raus = zeilen.flatMap(z => {
    const s = schluessel(z, k)
    if (!s) return []
    const med = zahl(z, 'GOOGLE_LISTINGS_IMPRESSIONS_BENCHMARK_MEDIAN')
    return [{
      b: s.betrieb, m: s.monat,
      ges: ganz(zahl(z, 'TOTAL_LISTINGS_IMPRESSIONS')),
      goo: ganz(zahl(z, 'GOOGLE_LISTINGS_IMPRESSIONS')),
      // 0 heisst hier "Yext fuehrt fuer diesen Betrieb keinen Vergleich",
      // nicht "der Vergleich liegt bei null". Als 0 gespeichert waere
      // jeder Betrieb ohne Vergleichsgruppe unendlich gut.
      ben: med && med > 0 ? Math.round(med) : null,
      suc: ganz(zahl(z, 'SEARCHES')),
      pro: ganz(zahl(z, 'PROFILE_VIEWS')),
      kli: ganz(zahl(z, 'CLICK_COUNT')),
      gen: zahl(z, 'LISTINGS_ACCURACY'),
      /*
       * POWERLISTINGS_LIVE, nicht LISTINGS_LIVE — genau das stand hier bis
       * zum 14.08.2026, und deshalb war `eintraege_live` in ALLEN 1.497
       * Zeilen NULL, waehrend die neun uebrigen Metriken derselben Antwort
       * gefuellt waren.
       *
       * Angefordert wurde die Metrik richtig (siehe die Liste oben);
       * gelesen wurde sie unter einem Namen, den die Antwort nicht kennt.
       * `zahl()` liefert dann null statt zu werfen — richtig so, denn Yext
       * laesst Metriken fuer einzelne Betriebe weg. Genau diese Nachsicht
       * hat den Tippfehler getragen.
       *
       * `mart.betrieb_sichtbarkeit` haengt an 6 Kartenstellen und zeigte
       * dort eine dauerhaft leere Spalte hinter einer gruenen Statusampel.
       */
      liv: ganz(zahl(z, 'POWERLISTINGS_LIVE')),
      una: ganz(zahl(z, 'UNAVAILABLE_REASON_COUNT')),
      vor: ganz(zahl(z, 'PUBLISHER_SUGGESTIONS')),
    }]
  })
  if (raus.length) {
    await query(
      `INSERT INTO core.betrieb_sichtbarkeit
         (betrieb_key, monat, impressionen_gesamt, impressionen_google, benchmark_google,
          suchen, profilaufrufe, klicks, genauigkeit, eintraege_live,
          eintraege_unavailable, vorschlaege_offen, geladen_am)
       SELECT b, m::date, ges, goo, ben, suc, pro, kli, gen, liv, una, vor, now()
         FROM unnest($1::int[], $2::text[], $3::bigint[], $4::bigint[], $5::bigint[],
                     $6::bigint[], $7::bigint[], $8::bigint[], $9::numeric[],
                     $10::int[], $11::int[], $12::int[])
              AS x(b, m, ges, goo, ben, suc, pro, kli, gen, liv, una, vor)
       ON CONFLICT (betrieb_key, monat) DO UPDATE SET
           impressionen_gesamt = excluded.impressionen_gesamt,
           impressionen_google = excluded.impressionen_google,
           benchmark_google    = excluded.benchmark_google,
           suchen              = excluded.suchen,
           profilaufrufe       = excluded.profilaufrufe,
           klicks              = excluded.klicks,
           genauigkeit         = excluded.genauigkeit,
           eintraege_live      = excluded.eintraege_live,
           eintraege_unavailable = excluded.eintraege_unavailable,
           vorschlaege_offen   = excluded.vorschlaege_offen,
           geladen_am          = now()`,
      [raus.map(x => x.b), raus.map(x => x.m), raus.map(x => x.ges), raus.map(x => x.goo),
       raus.map(x => x.ben), raus.map(x => x.suc), raus.map(x => x.pro), raus.map(x => x.kli),
       raus.map(x => x.gen), raus.map(x => x.liv), raus.map(x => x.una), raus.map(x => x.vor)])
  }
  return raus.length
}

// ---------------------------------------------------------------------
// Datenstand
// ---------------------------------------------------------------------
async function datenstandLaden() {
  const stand = await datenstand()
  if (!stand.length) return 0
  await query(
    `INSERT INTO core.yext_datenstand (metrik, vollstaendig_bis, geladen_am)
     SELECT m, b::date, now() FROM unnest($1::text[], $2::text[]) AS x(m, b)
     ON CONFLICT (metrik) DO UPDATE SET
         vollstaendig_bis = excluded.vollstaendig_bis, geladen_am = now()`,
    [stand.map(s => s.metrik), stand.map(s => s.bis)])
  return stand.length
}

/**
 * Alle vier Bloecke plus Datenstand. Sechs Aufrufe insgesamt.
 *
 * Ein Fehler bricht hier ab und wird NICHT je Betrieb aufgefangen wie in
 * laden.ts -- dort ist ein Aufruf ein Betrieb, hier sind alle Betriebe in
 * einem Aufruf. Ein Teilergebnis gibt es also gar nicht: entweder der
 * Bericht kommt, oder er kommt nicht.
 */
export async function analyticsLaden(opt: {
  monateAnzahl: number
  trocken?: boolean
}): Promise<AnalyticsErgebnis> {
  const ziel = await zuordnungen()
  const erg: AnalyticsErgebnis = {
    aufrufe: 0, themen: 0, antworten: 0, noten: 0, sichtbarkeit: 0, metriken: 0,
  }
  if (ziel.length === 0) {
    log.warn('kein Betrieb hat eine Yext-Zuordnung — Analytics uebersprungen',
      { hinweis: 'bun run src/yext_zuordnen.ts --schreiben' })
    return erg
  }

  const ids = ziel.map(z => z.fremd_id)
  const karte: Karte = new Map(ziel.map(z => [z.fremd_id, z.betrieb_key]))
  const f = fenster(opt.monateAnzahl)

  log.info('yext analytics laden', {
    betriebe: ids.length, von: f.startDate, bis: f.endDate,
    aufrufeErwartet: 6, schreiben: !opt.trocken,
  })

  if (opt.trocken) {
    // Trockenlauf holt nur den Datenstand -- der eine Aufruf, der nichts
    // schreibt und trotzdem zeigt, ob der Zugang traegt.
    const stand = await datenstand()
    erg.aufrufe = 1
    log.info('trocken: Datenstand', {
      metriken: stand.length,
      bewertungenBis: stand.find(s => s.metrik === 'NEW_REVIEWS')?.bis,
      aeltesteVollstaendig: stand.map(s => s.bis).sort()[0],
    })
    return erg
  }

  erg.themen = await themenLaden(karte, ids, f);        erg.aufrufe += 1
  erg.antworten = await antwortLaden(karte, ids, f);    erg.aufrufe += 3
  erg.noten = await notenLaden(karte, ids, f);          erg.aufrufe += 1
  erg.sichtbarkeit = await sichtbarkeitLaden(karte, ids, f); erg.aufrufe += 1
  erg.metriken = await datenstandLaden();               erg.aufrufe += 1

  log.info('yext analytics geladen', erg)
  return erg
}
