/**
 * Bewertungsstaende aus Yext nach core.bewertung_stand.
 *
 * DER TEURE TEIL IST DIE ZAHL DER AUFRUFE, NICHT DIE DATENMENGE. Ein Aufruf
 * liefert genau zwei Zahlen (Anzahl und Schnitt) fuer einen Betrieb, ein
 * Portal und einen Stichtag. Alles, was hier an Schleifen steht, hat deshalb
 * denselben Zweck: keinen Aufruf machen, dessen Antwort schon feststeht.
 *
 * Zwei Abkuerzungen tun das:
 *
 *   1. RUECKWAERTS DURCH DIE MONATE. Sobald ein Stand bei null Bewertungen
 *      steht, sind alle frueheren Monate ebenfalls null — Bewertungen
 *      verschwinden nicht rueckwirkend. Die Reihe bricht dort ab, nachdem die
 *      Null einmal geschrieben wurde. Diese eine Nullzeile ist wichtig: sie
 *      ist der Ankerpunkt, ohne den der Folgemonat keinen Vormonat haette und
 *      sein Monatswert in mart.bewertung_verlauf NULL bliebe.
 *
 *   2. NUR ZUGEORDNETE BETRIEBE. Das Konto enthaelt auch Standorte fremder
 *      Kunden der Family & Friends Marketing (Gimme Gelato, Pommes Freunde,
 *      my Indigo, Soulkitchen). Gefiltert wird ueber manual.betrieb_fremd_id,
 *      nie ueber Namen oder Ordner — ein Ordner ist eine Beschriftung, eine
 *      Zuordnung ist eine Entscheidung.
 */
import { query, eine, pool } from '../db/pool'
import { log } from '../lib/log'
import { bewertungsstand, bewertungen, YextFehler } from './client'

/**
 * Die Portale, die gespeichert werden.
 *
 * 'ALLE' (kein Filter) und Google nebeneinander, weil die Wahl die Kennzahl
 * sichtbar verschiebt und erst in der Sicht getroffen wird: bei Enchilada Hamm
 * 4,30 ueber alle Portale gegen 4,32 bei Google, und die Ampel steht bei 4,40.
 * Wer spaeter OpenTable dazunehmen will, ergaenzt hier eine Zeile — die
 * Tabelle traegt das Portal als Schluesselteil und braucht keine Migration.
 */
export const PORTALE = [
  { name: 'ALLE', filter: undefined as string | undefined },
  { name: 'GOOGLEMYBUSINESS', filter: 'GOOGLEMYBUSINESS' },
]

export type Monat = { erster: string; stichtag: string }

/**
 * Die zu ladenden Monate, juengster zuerst.
 *
 * Der laufende Monat ist noch nicht zu Ende; sein Stichtag ist deshalb heute
 * und nicht der Monatsletzte. Das ist gewollt: der Round Table soll den
 * aktuellen Stand zeigen, nicht auf den Monatswechsel warten.
 */
export function monate(anzahl: number, heute = new Date()): Monat[] {
  const raus: Monat[] = []
  const jahr = heute.getUTCFullYear(), monat = heute.getUTCMonth()
  for (let i = 0; i < anzahl; i++) {
    const erster = new Date(Date.UTC(jahr, monat - i, 1))
    // Tag 0 des Folgemonats ist der letzte Tag dieses Monats.
    const letzter = new Date(Date.UTC(jahr, monat - i + 1, 0))
    const stichtag = letzter > heute ? heute : letzter
    raus.push({ erster: erster.toISOString().slice(0, 10), stichtag: stichtag.toISOString().slice(0, 10) })
  }
  return raus
}

export type Zuordnung = { betrieb_key: number; fremd_id: string; name: string }

/** Die Betriebe mit einer entschiedenen Yext-Zuordnung. Nur die werden geladen. */
export async function zuordnungen(): Promise<Zuordnung[]> {
  return query<Zuordnung>(
    `SELECT f.betrieb_key, f.fremd_id, b.name
       FROM manual.betrieb_fremd_id f
       JOIN core.betrieb b USING (betrieb_key)
      WHERE f.system = 'yext'
      ORDER BY b.name`)
}

export type Ergebnis = {
  betriebe: number
  aufrufe: number
  zeilen: number
  fehler: { betrieb: string; grund: string }[]
}

/**
 * Laedt die Staende und schreibt sie weg.
 *
 * Ein Fehler bei einem Betrieb beendet den Lauf NICHT. Bei 66 Standorten und
 * einem Backfill ueber zwei Jahre waere das die falsche Reaktion: die anderen
 * 65 sind in Ordnung, und ein abgebrochener Lauf laesst die halbe Tabelle in
 * einem Zustand zurueck, den niemand ansieht. Der Fehler wird gesammelt und am
 * Ende genannt — sichtbar, aber nicht toedlich.
 */
export async function staendeLaden(opt: {
  monateAnzahl: number
  trocken?: boolean
  portale?: typeof PORTALE
}): Promise<Ergebnis> {
  const portale = opt.portale ?? PORTALE
  const ziel = await zuordnungen()
  const fenster = monate(opt.monateAnzahl)
  const erg: Ergebnis = { betriebe: 0, aufrufe: 0, zeilen: 0, fehler: [] }

  if (ziel.length === 0) {
    log.warn('kein Betrieb hat eine Yext-Zuordnung — nichts zu laden',
      { hinweis: 'bun run src/yext_zuordnen.ts --schreiben' })
    return erg
  }

  log.info('yext bewertungen laden', {
    betriebe: ziel.length, monate: fenster.length, portale: portale.map(p => p.name),
    von: fenster.at(-1)?.erster, bis: fenster[0]?.erster,
    aufrufeErwartet: `bis zu ${ziel.length * fenster.length * portale.length}`,
    schreiben: !opt.trocken,
  })

  for (const z of ziel) {
    const zeilen: { monat: string; publisher: string; anzahl: number; schnitt: number | null }[] = []
    try {
      for (const p of portale) {
        for (const m of fenster) {
          const s = await bewertungsstand(z.fremd_id, m.stichtag, p.filter)
          erg.aufrufe++
          zeilen.push({ monat: m.erster, publisher: p.name, anzahl: s.anzahl, schnitt: s.schnitt })
          // Die Null ist geschrieben, alles davor ist auch null: abbrechen.
          if (s.anzahl === 0) break
        }
      }
    } catch (e) {
      const grund = e instanceof YextFehler ? e.message : String((e as Error).message)
      log.warn('betrieb uebersprungen', { betrieb: z.name, entitaet: z.fremd_id, grund })
      erg.fehler.push({ betrieb: z.name, grund })
      // Was bis hierher zusammenkam, ist trotzdem gueltig und wird geschrieben.
    }

    if (zeilen.length && !opt.trocken) {
      await query(
        `INSERT INTO core.bewertung_stand (betrieb_key, monat, quelle, publisher, anzahl, schnitt, geladen_am)
         SELECT $1, m::date, 'yext', p, a, s, now()
           FROM unnest($2::text[], $3::text[], $4::int[], $5::numeric[]) AS t(m, p, a, s)
         ON CONFLICT (betrieb_key, monat, quelle, publisher) DO UPDATE SET
             anzahl = excluded.anzahl, schnitt = excluded.schnitt, geladen_am = now()`,
        [z.betrieb_key, zeilen.map(x => x.monat), zeilen.map(x => x.publisher),
         zeilen.map(x => x.anzahl), zeilen.map(x => x.schnitt)])
      erg.zeilen += zeilen.length
    }

    erg.betriebe++
    const juengste = zeilen.find(x => x.publisher === 'GOOGLEMYBUSINESS') ?? zeilen[0]
    log.info('betrieb geladen', {
      betrieb: z.name, entitaet: z.fremd_id, zeilen: zeilen.length,
      stand: juengste ? `${juengste.schnitt?.toFixed(2) ?? '—'} (${juengste.anzahl})` : '—',
      fortschritt: `${erg.betriebe}/${ziel.length}`,
    })
  }

  return erg
}

/**
 * Die einzelnen Bewertungen — zum LESEN, nicht zum Rechnen.
 *
 * Ausdrueckliche Abweichung von docs/yext-anbindung.md §3, entschieden am
 * 03.08.2026: eine Zahl sagt, DASS ein Haus abrutscht, erst der Text sagt
 * woran. Mit Autorenname (Migration 0038, am selben Tag nachgezogen: die
 * Namen stehen oeffentlich neben der Bewertung), ohne E-Mail-Adresse und
 * ohne die Antworten des Betriebs -- der Typ `YextBewertung` fuehrt diese
 * Felder gar nicht erst.
 *
 * WARUM DAS NICHT DIE STAENDE ERSETZT, obwohl man aus diesen Zeilen einen
 * Durchschnitt rechnen koennte: eine geloeschte Bewertung verschwindet bei
 * Yext sofort aus dem Aggregat, unsere Kopie bliebe stehen. Die Kennzahl
 * kaeme dann langsam auseinander mit dem, was ein Gast auf Google sieht --
 * und zwar unbemerkt, weil beide Zahlen plausibel aussehen.
 *
 * INKREMENTELL ueber `minPublisherDate`: der erste Lauf holt alles (rund
 * 1.700 Aufrufe), jeder weitere nur, was seit dem juengsten gespeicherten
 * Datum dazukam. Mit einer Woche Rueckgriff, weil Portale verzoegert
 * durchreichen.
 */
export async function bewertungenLaden(opt: {
  voll?: boolean
  rueckgriffTage?: number
} = {}): Promise<Ergebnis> {
  const ziel = await zuordnungen()
  const erg: Ergebnis = { betriebe: 0, aufrufe: 0, zeilen: 0, fehler: [] }
  const rueckgriff = opt.rueckgriffTage ?? 7

  log.info('yext einzelbewertungen laden', {
    betriebe: ziel.length, voll: Boolean(opt.voll), rueckgriffTage: rueckgriff,
  })

  for (const z of ziel) {
    try {
      let ab: string | undefined
      if (!opt.voll) {
        const r = await eine<{ ab: string | null }>(
          `SELECT (max(publiziert_am) - ($2 || ' days')::interval)::date::text AS ab
             FROM core.bewertung WHERE betrieb_key = $1 AND quelle = 'yext'`,
          [z.betrieb_key, rueckgriff])
        ab = r?.ab ?? undefined
      }

      const roh = await bewertungen(z.fremd_id, ab)
      // Ein Aufruf je 100 Bewertungen, aufgerundet, mindestens einer.
      erg.aufrufe += Math.max(1, Math.ceil(roh.length / 100))

      // Ohne publisherDate laesst sich die Zeile keinem Monat zuordnen und
      // waere in jeder Auswertung ein stiller Ausreisser.
      const brauchbar = roh.filter(b => b.id != null && b.publisherDate != null)
      if (brauchbar.length) {
        await query(
          `INSERT INTO core.bewertung
             (quelle, bewertung_id, betrieb_key, publisher, rating, publiziert_am,
              status, inhalt, autor, url, geladen_am)
           SELECT 'yext', id, $1, pub, r, to_timestamp(ms / 1000.0), st,
                  nullif(btrim(txt), ''), nullif(btrim(a), ''), u, now()
             FROM unnest($2::text[], $3::text[], $4::numeric[], $5::bigint[],
                         $6::text[], $7::text[], $8::text[], $9::text[])
                  AS t(id, pub, r, ms, st, txt, u, a)
           ON CONFLICT (quelle, bewertung_id) DO UPDATE SET
               rating        = excluded.rating,
               status        = excluded.status,
               inhalt        = excluded.inhalt,
               autor         = excluded.autor,
               publiziert_am = excluded.publiziert_am,
               url           = excluded.url,
               geladen_am    = now()`,
          [z.betrieb_key,
           brauchbar.map(b => String(b.id)),
           brauchbar.map(b => b.publisherId ?? '?'),
           brauchbar.map(b => (typeof b.rating === 'number' ? b.rating : null)),
           brauchbar.map(b => b.publisherDate!),
           brauchbar.map(b => b.status ?? 'LIVE'),
           brauchbar.map(b => b.content ?? null),
           brauchbar.map(b => b.url ?? null),
           brauchbar.map(b => b.authorName ?? null)])
        erg.zeilen += brauchbar.length
      }

      erg.betriebe++
      log.info('bewertungen geladen', {
        betrieb: z.name, entitaet: z.fremd_id, ab: ab ?? 'alles',
        geholt: roh.length, gespeichert: brauchbar.length,
        mitText: brauchbar.filter(b => (b.content ?? '').trim()).length,
        fortschritt: `${erg.betriebe}/${ziel.length}`,
      })
    } catch (e) {
      const grund = e instanceof YextFehler ? e.message : String((e as Error).message)
      log.warn('betrieb uebersprungen', { betrieb: z.name, entitaet: z.fremd_id, grund })
      erg.fehler.push({ betrieb: z.name, grund })
    }
  }

  return erg
}

/** Traegt den Stand als Round-Table-Kennzahl ein. */
export async function kennzahlFuellen(publisher = 'GOOGLEMYBUSINESS'): Promise<number> {
  const r = await query<{ n: number }>(
    'SELECT manual.online_bewertung_aus_yext($1) AS n', [publisher])
  return Number(r[0]?.n ?? 0)
}

/** Was der letzte Lauf getan hat — fuer /status und fuer den naechsten Menschen. */
export async function laufMerken(erg: Ergebnis, kennzahlZeilen: number, publisher: string) {
  await query(
    `INSERT INTO sync.merker (schluessel, wert) VALUES ('yext_letzter_lauf', $1::jsonb)
     ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`,
    [JSON.stringify({
      beendet_am: new Date().toISOString(),
      betriebe: erg.betriebe, aufrufe: erg.aufrufe, zeilen: erg.zeilen,
      kennzahl_zeilen: kennzahlZeilen, publisher,
      fehler: erg.fehler.length, fehler_details: erg.fehler.slice(0, 5),
    })])
}

export { pool }
