/**
 * Transformationen der Betriebsberichte — reine Funktionen, JSON rein, Zeilen raus.
 *
 * DIE HÜLLE (für alle 72 gleich, an den echten Antworten vom 22.09.2026 abgelesen):
 *
 *   { title, timeframe, from, to, nBillsGesamt, balanceSumBrutto, balanceSumNetto,
 *     possibleIntervals, defaultInterval, errors?,
 *     tableHead: [[{id, field, header, sortable}, …], …],   ← je Block eine Kopfliste
 *     table:     [{ "0": {Feld: {value, style?, decimal?}, …}, "1": …,
 *                   businessDate: "01.08.2026" | "01.08.2026 - 31.08.2026" }, …] }
 *
 * Die Zeilen sind Objekte mit ZIFFERNSCHLÜSSELN, keine Arrays — die Reihenfolge
 * steckt in der Zahl, nicht in der Einfügung. Eine Zelle ist `{value, …}`,
 * gelegentlich `null` (Abschnittsköpfe in 88/97).
 *
 * DREI EIGENHEITEN, die jede Auswertung sonst verfälschen:
 *
 *  1. SPALTENBESCHRIFTUNG IM DATENFELD. 96 trägt in 20 von 519 Bons den Text
 *     „Finanzwege" in der Spalte Finanzwege, 57 „Anzahl Artikel" in Anzahl_Artikel,
 *     39 „Artikel" in Artikel, 113 „Status" in Status. Eine Zelle, deren Text
 *     gleich der Spaltenüberschrift ist, ist keine Angabe, sondern NULL.
 *  2. ANZAHLEN ALS TEXT. „7", „-1", „3226" — mal Zahl, mal String, in derselben Spalte.
 *  3. DATUM ALS UNIX-SEKUNDEN der Berliner Mitternacht (1786744800 = 15.08.2026).
 *     In UTC ist das der 14.08. um 22:00 — wer UTC nimmt, verschiebt jeden Tag.
 */
import { linaEpochAlsDatum } from '../lib/time'

export type Block = {
  /** `tableHead[].field` in Reihenfolge. */
  felder: string[]
  /** field → header, für die Erkennung eingerutschter Spaltenbeschriftungen. */
  kopf: Record<string, string>
  /** Die Zeilen in Ziffernreihenfolge, Zellen roh (mit `value`, `style`). */
  zeilen: Record<string, unknown>[]
  /** `businessDate` des Blocks, als ISO-Zeitraum. */
  von: string | null
  bis: string | null
}

export type Huelle = {
  titel: string | null
  nBills: number | null
  balanceBrutto: number | null
  balanceNetto: number | null
  /** LINAs `errors` — ein fachlicher Hinweis, kein technischer Fehler. */
  hinweis: string | null
  intervalle: number[]
  bloecke: Block[]
}

/** „01.08.2026" → „2026-08-01". Alles andere → null. */
export function deDatum(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim())
  if (!m) return null
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
}

/** `businessDate` → Zeitraum. „01.08.2026 - 31.08.2026" oder ein einzelner Tag. */
export function geschaeftsZeitraum(s: unknown): { von: string | null; bis: string | null } {
  if (typeof s !== 'string') return { von: null, bis: null }
  const teile = s.split(/\s+-\s+/)
  const von = deDatum(teile[0])
  const bis = teile.length > 1 ? deDatum(teile[1]) : von
  return { von, bis }
}

/**
 * Die Hülle auspacken. Nimmt auch den doppelt kodierten String an — der Client
 * packt ihn zwar schon aus, aber ein Test oder ein Neuaufbau aus raw soll sich
 * darauf nicht verlassen müssen.
 */
export function berichtEntpacken(daten: unknown): Huelle {
  let d: any = daten
  if (typeof d === 'string') d = JSON.parse(d)
  if (d === null || typeof d !== 'object') throw new Error('Betriebsbericht: Antwort ist kein Objekt')
  const koepfe: any[] = Array.isArray(d.tableHead) ? d.tableHead : []
  const tabelle: any[] = Array.isArray(d.table) ? d.table : []
  const bloecke: Block[] = tabelle.map((b: any, i: number) => {
    // 97 hat je Block eine Kopfliste; alle anderen EINE für alle Blöcke.
    const kopfListe: any[] = koepfe[i] ?? koepfe[0] ?? []
    const felder = kopfListe.map(h => String(h.field))
    const kopf: Record<string, string> = {}
    for (const h of kopfListe) kopf[String(h.field)] = String(h.header ?? h.field)
    const ziffern = Object.keys(b ?? {}).filter(k => /^\d+$/.test(k)).sort((x, y) => Number(x) - Number(y))
    const { von, bis } = geschaeftsZeitraum(b?.businessDate)
    return { felder, kopf, zeilen: ziffern.map(k => b[k] ?? {}), von, bis }
  })
  const hinweis = d.errors === undefined || d.errors === null ? null
    : (typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors)).trim() || null
  return {
    titel: typeof d.title === 'string' ? d.title : null,
    nBills: zahl(d.nBillsGesamt),
    balanceBrutto: zahl(d.balanceSumBrutto),
    balanceNetto: zahl(d.balanceSumNetto),
    hinweis,
    intervalle: Array.isArray(d.possibleIntervals) ? d.possibleIntervals.map((i: any) => Number(i?.value)) : [],
    bloecke,
  }
}

/** Der Rohwert einer Zelle: `{value}` → value, sonst die Zelle selbst. */
export function roh(zelle: unknown): unknown {
  if (zelle !== null && typeof zelle === 'object' && 'value' in (zelle as object)) {
    return (zelle as { value: unknown }).value
  }
  return zelle ?? null
}

/** Ist die Zelle fett gesetzt? So kennzeichnet 92 seine Gruppenköpfe. */
export function fett(zelle: unknown): boolean {
  const st = zelle !== null && typeof zelle === 'object' ? (zelle as { style?: unknown }).style : null
  return typeof st === 'string' && /font-weight:\s*bold/i.test(st)
}

/** Zahl oder Zahl-als-Text. Leerer Text, Unfug und NaN → null. */
export function zahl(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Ganzzahl im int4-Bereich, sonst null (Anzahlen, Nummern). */
export function ganz(v: unknown): number | null {
  const n = zahl(v)
  if (n === null || !Number.isInteger(n) || Math.abs(n) > 2_147_483_647) return null
  return n
}

/** Text; leer → null. */
export function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

/**
 * Den Wert eines Feldes lesen — mit Eigenheit 1: steht in der Zelle genau die
 * Spaltenüberschrift, ist es keine Angabe.
 */
export function feld(b: Block, zeile: Record<string, unknown>, f: string): unknown {
  const v = roh(zeile[f])
  if (typeof v === 'string' && (v === b.kopf[f] || v === f)) return null
  return v
}

// --------------------------------------------------------------------------
// 92 — Rabattbericht
// --------------------------------------------------------------------------

export type RabattZeile = {
  /** Laufende Nummer der Zeile in der Antwort — der Schlüssel in core. */
  zeile: number
  /** Laufende Nummer des Gruppenkopfs (1, 2, …). Zwei Gruppen dürfen denselben Namen tragen. */
  gruppe: number
  finanzwegName: string
  /** NULL ist echt: 28 Zeilen im August trugen keinen Artikelnamen, wohl aber Anzahl und Betrag. */
  artikelName: string | null
  anzahl: number | null
  brutto: number | null
  netto: number | null
}

export type RabattErgebnis = {
  zeilen: RabattZeile[]
  /** Je Gruppe: was der Kopf sagt und was die Zeilen darunter ergeben. */
  koepfe: { gruppe: number; finanzwegName: string; kopfAnzahl: number | null; kopfBrutto: number | null;
            summeAnzahl: number; summeBrutto: number }[]
}

/**
 * Rabattbericht zerlegen.
 *
 * Jede Gruppe beginnt mit einer Kopfzeile: `Artikel = null`, `Rabatt` fett, und
 * die Summe der Gruppe in Anzahl/Brutto/Netto. Darunter die Artikelzeilen.
 *
 * DER KOPF WIRD ERKANNT, NICHT GERATEN: `Artikel` leer UND (fett ODER ein
 * anderer Rabattname als die Zeile davor). Nur „Artikel leer" reicht nicht —
 * gemessen am 22.09.2026 tragen 28 von 225 artikelnamenlosen Zeilen echte
 * Werte (Bochum, „50% Glücksrad": Kopf 1175, dann zwei Zeilen ohne Namen mit
 * 1 und 15 Stück). Nur „fett" reicht auch nicht, wenn LINA den Stil ändert.
 *
 * Die Summe der Zeilen unter einem Kopf trifft den Kopf (Anzahl und Brutto) —
 * das prüft der Lader und meldet Abweichungen nach sync.schema_abweichung.
 */
export function rabattbericht(h: Huelle): RabattErgebnis {
  const zeilen: RabattZeile[] = []
  const koepfe: RabattErgebnis['koepfe'] = []
  let gruppe = 0
  let aktuell: string | null = null
  let n = 0
  for (const b of h.bloecke) {
    for (const z of b.zeilen) {
      n++
      const name = text(roh(z.Rabatt))
      const artikel = text(feld(b, z, 'Artikel'))
      const istKopf = artikel === null && (fett(z.Rabatt) || name !== aktuell)
      if (istKopf) {
        gruppe++
        aktuell = name
        koepfe.push({
          gruppe, finanzwegName: name ?? '',
          kopfAnzahl: zahl(roh(z.Anzahl)), kopfBrutto: zahl(roh(z.Brutto)),
          summeAnzahl: 0, summeBrutto: 0,
        })
        continue
      }
      if (name === null) continue
      const zeile: RabattZeile = {
        zeile: n, gruppe, finanzwegName: name, artikelName: artikel,
        anzahl: zahl(roh(z.Anzahl)), brutto: zahl(roh(z.Brutto)), netto: zahl(roh(z.Netto)),
      }
      zeilen.push(zeile)
      const k = koepfe[koepfe.length - 1]
      if (k) { k.summeAnzahl += zeile.anzahl ?? 0; k.summeBrutto += zeile.brutto ?? 0 }
    }
  }
  return { zeilen, koepfe }
}

// --------------------------------------------------------------------------
// 88 und 97 — Finanzwege
// --------------------------------------------------------------------------

export type FinanzwegZeile = {
  /** Der Tag des Blocks (nur 97, interval=3), sonst null — dann gilt der Abrufzeitraum. */
  geschaeftstag: string | null
  /** Abschnitt der Tabelle: „Umsätze", „Zahlungswege", „Rabatte", „Sonstiges". */
  abschnitt: string | null
  nummer: number
  name: string
  gruppe: string | null
  umsatz: number | null
  anzahl: number | null
}

/**
 * Die Finanzwegtabelle — aus 88 (ein Block über den Abrufzeitraum) und aus 97
 * (ein solcher Block je Tag, neben dem Hauptsparten-Block).
 *
 * `proTag`: nur bei 97 trägt jeder Block seinen Tag. `businessDate` ist sonst
 * KEIN Beleg für den Zeitraum — gemessen am 22.09.2026: 88 meldet für einen
 * Monatsaufruf (1.8.–31.8.) `businessDate: "01.08.2026"`, also nur den ersten
 * Tag, während 27, 55 und 92 für denselben Zeitraum „01.08.2026 - 31.08.2026"
 * schreiben. Wer das Blockdatum von 88 als Tag nimmt, bucht einen Monat auf
 * den Ersten. Der Tag kommt deshalb bei 88 aus dem Posten, nicht aus der Antwort.
 *
 * Nur Zeilen mit NUMERISCHER `Nummer` sind Finanzwege. Die übrigen sind
 * Abschnittsköpfe („Umsätze", Zellen null) und Summen („Gesamt Umsatz",
 * „Summe Umsätze - Zahlungen") — die Summen lassen sich aus den Zeilen rechnen
 * und würden jede Summe darüber verdoppeln.
 */
export function finanzwege(h: Huelle, proTag = false): FinanzwegZeile[] {
  const out: FinanzwegZeile[] = []
  for (const b of h.bloecke) {
    if (!b.felder.includes('Nummer') || !b.felder.includes('Finanzweg')) continue
    const tag = proTag && b.von !== null && b.von === b.bis ? b.von : null
    let abschnitt: string | null = null
    for (const z of b.zeilen) {
      const nr = roh(z.Nummer)
      const name = text(roh(z.Finanzweg))
      if (typeof nr === 'string' && !/^-?\d+$/.test(nr.trim())) {
        // Ein Abschnittskopf hat keinen Finanzweg (Zelle null); eine
        // Summenzeile hat einen leeren. Nur der Kopf benennt den Abschnitt.
        if (z.Finanzweg === null || z.Finanzweg === undefined) abschnitt = nr.trim()
        continue
      }
      const nummer = ganz(nr)
      if (nummer === null || name === null) continue
      out.push({
        geschaeftstag: tag, abschnitt, nummer, name,
        gruppe: text(roh(z.Finanzgruppe)),
        umsatz: zahl(roh(z.Umsatz)), anzahl: zahl(roh(z.Anzahl)),
      })
    }
  }
  return out
}

/**
 * Art eines Finanzwegs — ABGELEITET aus der Finanzgruppe, nicht von LINA
 * geliefert. Hausbon und Rabatt sind Nachlässe (die Glücksrad-Wege stehen in
 * Hausbon, Personalrabatte in Rabatt), Unbar/Bargeld/Gutschein/Auslagen sind
 * Zahlarten, Statistik (Tischübergabe) ist keins von beiden.
 */
export function finanzwegArt(gruppe: string | null): string | null {
  if (!gruppe) return null
  const g = gruppe.toLowerCase()
  if (g === 'hausbon' || g === 'rabatt') return 'nachlass'
  if (g === 'umsatz') return 'umsatz'
  if (g === 'statistik') return 'statistik'
  return 'zahlart'
}

/**
 * Prozentsatz aus dem Namen („50% Glücksrad" → 50, „Perso 40%" → 40,
 * „Family&Friends20 %" → 20). ABGELEITET — ein Name ohne Prozentzahl ergibt null.
 */
export function prozentAusName(name: string | null): number | null {
  if (!name) return null
  const m = /(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(name)
  if (!m) return null
  const n = Number(m[1]!.replace(',', '.'))
  return Number.isFinite(n) && n <= 100 ? n : null
}

// --------------------------------------------------------------------------
// 97 — Tagesabschluss, Block Hauptsparte × Steuersatz
// --------------------------------------------------------------------------

export type TagesabschlussZeile = {
  geschaeftstag: string
  hauptsparte: string
  /** Das Spaltenfeld, wie LINA es nennt: „19%_Mwst", „7%_Mwst", „0%", … */
  steuersatz: string
  brutto: number
}

/**
 * Je Tag ein Block mit einer Zeile je Hauptsparte und einer Spalte je
 * Steuersatz. Die Werte sind BRUTTO: über August summiert ergeben sie genau
 * `balanceSumBrutto` (369.841,09 bei Wilma Wunder Düsseldorf, gemessen
 * 22.09.2026). Nullzellen werden nicht geschrieben.
 */
export function tagesabschlussSparten(h: Huelle): TagesabschlussZeile[] {
  const out: TagesabschlussZeile[] = []
  for (const b of h.bloecke) {
    if (!b.felder.includes('Hauptsparte')) continue
    const tag = b.von !== null && b.von === b.bis ? b.von : null
    if (!tag) continue
    for (const z of b.zeilen) {
      const hs = text(roh(z.Hauptsparte))
      if (!hs) continue
      for (const f of b.felder) {
        if (f === 'Hauptsparte') continue
        const w = zahl(roh(z[f]))
        if (w === null || w === 0) continue
        out.push({ geschaeftstag: tag, hauptsparte: hs, steuersatz: f, brutto: w })
      }
    }
  }
  return out
}

// --------------------------------------------------------------------------
// 96 — Rechnungsausgangsbuch (eine Zeile je Bon)
// --------------------------------------------------------------------------

export type BonZeile = {
  geschaeftstag: string
  /** Laufende Nummer je Tag in Antwortreihenfolge — der Schlüssel in core. */
  laufnummer: number
  rechnungsnummer: number | null
  art: string | null
  anzahlArtikel: number | null
  finanzwege: string[]
  brutto: number | null
  debitor: string | null
  debitorAnschrift: string | null
}

/**
 * Bons aus 96 (und in derselben Form aus 86 und 113).
 *
 * `Rechnungsnummer` ist KEIN Schlüssel: am 15.08.2026 trugen neun Bons die
 * Nummer 0, und Gutschriften haben einen eigenen Nummernkreis. Der Schlüssel
 * ist die laufende Nummer je Tag.
 *
 * Die Summenzeile (ohne gültiges Datum) fällt weg.
 */
export function bons(h: Huelle, artFeld = 'Rechnung/Butschrift'): BonZeile[] {
  const out: BonZeile[] = []
  const lauf = new Map<string, number>()
  for (const b of h.bloecke) {
    for (const z of b.zeilen) {
      const tag = linaEpochAlsDatum(roh(z.Datum))
      if (!tag) continue
      const n = (lauf.get(tag) ?? 0) + 1
      lauf.set(tag, n)
      const fw = text(feld(b, z, 'Finanzwege'))
      out.push({
        geschaeftstag: tag, laufnummer: n,
        rechnungsnummer: ganz(roh(z.Rechnungsnummer)),
        art: text(feld(b, z, artFeld)),
        anzahlArtikel: ganz(feld(b, z, 'Anzahl_Artikel')),
        finanzwege: fw ? fw.split(',').map(s => s.trim()).filter(Boolean) : [],
        brutto: zahl(roh(z.Brutto)),
        debitor: text(feld(b, z, 'Debitor')),
        debitorAnschrift: text(feld(b, z, 'Debitor_-_Anschrift')),
      })
    }
  }
  return out
}

// --------------------------------------------------------------------------
// Stufe B — ein Spaltenplan je Bericht statt eines Laders je Bericht
// --------------------------------------------------------------------------

export type Spaltentyp = 'text' | 'ganz' | 'zahl' | 'datum' | 'liste'

export type Spaltenplan = {
  tabelle: string
  /**
   * Woher das Datum der Zeile kommt:
   *   'monat'  — der Monat des Abrufs (Spalte `monat`)
   *   Feldname — ein Datumsfeld der Zeile (Spalte `geschaeftstag`); Zeilen ohne
   *              gültiges Datum sind Summen und fallen weg
   */
  zeit: 'monat' | { feld: string }
  spalten: { feld: string; spalte: string; typ: Spaltentyp }[]
  /** Alle übrigen Felder als jsonb in diese Spalte (wechselnde Steuersatzspalten). */
  rest?: string
  /**
   * Kopfzeilen, die eine Gruppe eröffnen. `leer`: das Feld ist leer (53, 61 —
   * je Kellner ein Kopf ohne Kellnernummer); `kein_muster`: das Feld passt NICHT
   * auf das Muster (75/76 — die Sparte steht, wo sonst das Zeitfenster steht).
   * Der Kopf selbst wird mit `ist_kopf = true` geschrieben; die Gruppe zählt in
   * `kontext_spalte` hoch (Nummer) bzw. trägt den Kopftext.
   */
  kopf?: { feld: string; wenn: 'leer' } & { kontext_spalte: string; kontext: 'nummer' }
       | { feld: string; wenn: 'kein_muster'; muster: RegExp; kontext_spalte: string; kontext: 'text' }
  /** Verdichten statt Zeile für Zeile (99: eine Zeile je Zahlung, ohne Kennung). */
  verdichten?: { schluessel: string[]; summen: string[]; anzahl_spalte: string }
}

export type PlanZeile = Record<string, unknown>

function wert(b: Block, z: Record<string, unknown>, f: string, typ: Spaltentyp): unknown {
  const v = feld(b, z, f)
  switch (typ) {
    case 'text': return text(v)
    case 'ganz': return ganz(v)
    case 'zahl': return zahl(v)
    case 'datum': return linaEpochAlsDatum(v)
    case 'liste': { const t = text(v); return t ? t.split(',').map(s => s.trim()).filter(Boolean) : [] }
  }
}

/**
 * Einen Bericht nach seinem Spaltenplan in Zeilen verwandeln. Jede Zeile trägt
 * `zeile` (laufende Nummer in der Antwort) und je nach Plan `geschaeftstag`,
 * `ist_kopf` und die Kontextspalte.
 */
export function nachPlan(h: Huelle, plan: Spaltenplan): PlanZeile[] {
  const out: PlanZeile[] = []
  let n = 0
  let kontext: number | string | null = null
  let nummer = 0
  const bekannt = new Set(plan.spalten.map(s => s.feld))
  if (typeof plan.zeit === 'object') bekannt.add(plan.zeit.feld)
  for (const b of h.bloecke) {
    for (const z of b.zeilen) {
      n++
      const r: PlanZeile = { zeile: n }
      if (typeof plan.zeit === 'object') {
        // Zeilen ohne gueltiges Datum sind Summen (86: die erste Zeile).
        const tag = linaEpochAlsDatum(roh(z[plan.zeit.feld]))
        if (!tag) continue
        r.geschaeftstag = tag
      }
      if (plan.kopf) {
        const v = roh(z[plan.kopf.feld])
        const istKopf = plan.kopf.wenn === 'leer'
          ? v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
          : typeof v === 'string' && !plan.kopf.muster.test(v.trim())
        if (istKopf) {
          nummer++
          kontext = plan.kopf.kontext === 'nummer' ? nummer : text(v)
        }
        r.ist_kopf = istKopf
        r[plan.kopf.kontext_spalte] = kontext
      }
      for (const s of plan.spalten) r[s.spalte] = wert(b, z, s.feld, s.typ)
      if (plan.rest) {
        const rest: Record<string, unknown> = {}
        for (const f of b.felder) if (!bekannt.has(f)) rest[f] = zahl(roh(z[f])) ?? text(roh(z[f]))
        r[plan.rest] = rest
      }
      out.push(r)
    }
  }
  if (!plan.verdichten) return out

  const v = plan.verdichten
  const gruppen = new Map<string, PlanZeile>()
  for (const r of out) {
    const k = JSON.stringify(v.schluessel.map(s => r[s]))
    let g = gruppen.get(k)
    if (!g) {
      g = { zeile: gruppen.size + 1, [v.anzahl_spalte]: 0 }
      for (const s of v.schluessel) g[s] = r[s]
      for (const s of v.summen) g[s] = 0
      gruppen.set(k, g)
    }
    g[v.anzahl_spalte] = (g[v.anzahl_spalte] as number) + 1
    for (const s of v.summen) g[s] = (g[s] as number) + ((r[s] as number | null) ?? 0)
  }
  return [...gruppen.values()]
}
