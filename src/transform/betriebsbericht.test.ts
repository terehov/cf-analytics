/**
 * Die Transformation der Betriebsberichte gegen ECHTE Antworten vom 22.09.2026.
 *
 * Der wichtigste Test hier ist der Abnahmetest M1 aus docs/plan-lina-vollabzug.md:
 * die Glücksrad-Auswertung für den Fachbereich (docs/gluecksrad-august-2026-finanzwege.xlsx)
 * muss sich aus den Rohantworten GENAU reproduzieren lassen. Reproduziert der Test
 * nicht, ist der Lader falsch, nicht die Excel.
 *
 * Kein Datenbankzugriff — die Datenbankseite desselben Tests steht in
 * src/sync/betriebsbericht.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as bt from './betriebsbericht'
import { betriebsberichtSchema } from '../lina/schemas'
import { endpunkt } from '../lina/endpunkte'
import { SPALTENPLAENE } from '../sync/betriebsbericht_laden'

const fixture = (name: string) => JSON.parse(readFileSync(
  new URL(`./fixtures/betriebsbericht/${name}`, import.meta.url), 'utf8'))

const r92 = fixture('report92-wilma-2026-08.json') as {
  betriebe: { encId: string; name: string; antwort: unknown }[]
}

/** Die Auswertung vom 22.09.2026 — Prozentsatz aus dem Namen, nur Zeilen MIT Artikelnamen. */
function gluecksrad() {
  const je: Record<string, number> = { '10': 0, '25': 0, '50': 0 }
  const durch: Record<string, number> = { '10': 0, '25': 0, '50': 0 }
  const namen = new Set<string>()
  for (const b of r92.betriebe) {
    for (const z of bt.rabattbericht(bt.berichtEntpacken(b.antwort)).zeilen) {
      if (!z.finanzwegName.includes('Glücksrad') || z.artikelName === null) continue
      namen.add(z.finanzwegName)
      const p = String(bt.prozentAusName(z.finanzwegName))
      je[p] = (je[p] ?? 0) + (z.anzahl ?? 0)
      if (z.artikelName === 'Durchstarter') durch[p] = (durch[p] ?? 0) + (z.anzahl ?? 0)
    }
  }
  return { je, durch, namen }
}

describe('Abnahme M1: Glücksrad August 2026, 14 Wilma-Wunder-Betriebe', () => {
  test('die Fixture enthält 14 Betriebe mit Umsatz und einen geschlossenen', () => {
    const mitUmsatz = r92.betriebe.filter(b => (bt.berichtEntpacken(b.antwort).nBills ?? 0) > 0)
    expect(mitUmsatz).toHaveLength(14)
    expect(r92.betriebe).toHaveLength(15)
    // Der 14. heißt in LINA nicht „Wilma" — Markt Mainz ist „Gastronomie am Markt Mainz GmbH".
    expect(r92.betriebe.some(b => b.name.includes('Markt Mainz'))).toBe(true)
  })

  test('10 %: 149 Stück, 25 % (beide Nummern): 1.413, 50 %: 7.335', () => {
    const { je } = gluecksrad()
    expect(je['10']).toBe(149)
    expect(je['25']).toBe(1413)
    expect(je['50']).toBe(7335)
  })

  test('Durchstarter: 12 / 107 / 432 = 551', () => {
    const { durch } = gluecksrad()
    expect(durch['10']).toBe(12)
    expect(durch['25']).toBe(107)
    expect(durch['50']).toBe(432)
    expect(durch['10']! + durch['25']! + durch['50']!).toBe(551)
  })

  test('es gibt ZWEI 25-%-Finanzwege, die sich nur am Apostroph unterscheiden', () => {
    const { namen } = gluecksrad()
    expect([...namen].sort()).toEqual(['10% Glücksrad', '25% Glücksrad', "25% Glücksrad'", '50% Glücksrad'])
  })

  test('die Summe der Zeilen trifft in JEDER Gruppe den Gruppenkopf', () => {
    let gruppen = 0
    for (const b of r92.betriebe) {
      const { koepfe } = bt.rabattbericht(bt.berichtEntpacken(b.antwort))
      for (const k of koepfe) {
        gruppen++
        expect({ g: k.finanzwegName, a: k.summeAnzahl }).toEqual({ g: k.finanzwegName, a: k.kopfAnzahl! })
        expect(Math.abs(k.summeBrutto - k.kopfBrutto!)).toBeLessThan(0.01)
      }
    }
    expect(gruppen).toBe(197)
  })

  /**
   * Die Falle bei der Kopferkennung: „Artikel leer" allein ist kein Kopf.
   * Bochum führt unter „50% Glücksrad" nach dem Kopf (1.175) zwei Zeilen ohne
   * Namen mit 1 und 15 Stück — echte Zeilen, die die Kopfsumme schließen.
   */
  test('Zeilen ohne Artikelnamen sind Daten, keine Köpfe', () => {
    const bochum = r92.betriebe.find(b => b.name.endsWith('Bochum'))!
    const { zeilen, koepfe } = bt.rabattbericht(bt.berichtEntpacken(bochum.antwort))
    const kopf50 = koepfe.find(k => k.finanzwegName === '50% Glücksrad')!
    expect(kopf50.kopfAnzahl).toBe(1175)
    const ohne = zeilen.filter(z => z.gruppe === kopf50.gruppe && z.artikelName === null)
    expect(ohne.map(z => z.anzahl).sort((a, b) => a! - b!)).toEqual([1, 15])
  })

  test('der Nachlass gilt für den ganzen Bon: über 300 Artikel tragen Glücksrad', () => {
    const artikel = new Set<string>()
    for (const b of r92.betriebe) {
      for (const z of bt.rabattbericht(bt.berichtEntpacken(b.antwort)).zeilen) {
        if (z.finanzwegName.includes('Glücksrad') && z.artikelName) artikel.add(z.artikelName)
      }
    }
    expect(artikel.size).toBeGreaterThan(300)
  })

  test('die Antwort des geschlossenen Betriebs ist leer, nicht kaputt', () => {
    const zu = r92.betriebe.find(b => b.name.includes('geschl'))!
    const h = bt.berichtEntpacken(zu.antwort)
    expect(h.nBills).toBe(0)
    expect(bt.rabattbericht(h).zeilen).toEqual([])
  })
})

describe('Hülle', () => {
  test('doppelt kodiert: ein JSON-String mit JSON darin wird ausgepackt', () => {
    const b = r92.betriebe[1]!.antwort
    const h1 = bt.berichtEntpacken(b)
    const h2 = bt.berichtEntpacken(JSON.stringify(b))
    expect(h2.nBills).toBe(h1.nBills)
    expect(h2.bloecke[0]!.zeilen.length).toBe(h1.bloecke[0]!.zeilen.length)
  })

  test('businessDate: einzelner Tag und Zeitraum', () => {
    expect(bt.geschaeftsZeitraum('15.08.2026')).toEqual({ von: '2026-08-15', bis: '2026-08-15' })
    expect(bt.geschaeftsZeitraum('01.08.2026 - 31.08.2026')).toEqual({ von: '2026-08-01', bis: '2026-08-31' })
  })

  test('Prozentsatz aus dem Namen — Prozentzahl, kein Bruch (Regel 6)', () => {
    expect(bt.prozentAusName('50% Glücksrad')).toBe(50)
    expect(bt.prozentAusName("25% Glücksrad'")).toBe(25)
    expect(bt.prozentAusName('Perso 40%')).toBe(40)
    expect(bt.prozentAusName('Family&Friends20 %')).toBe(20)
    expect(bt.prozentAusName('NeoTaste')).toBeNull()
  })
})

describe('Finanzwege (88) und Tagesabschluss (97), Wilma Wunder Düsseldorf, August 2026', () => {
  const h88 = bt.berichtEntpacken(fixture('report88-duesseldorf-2026-08.json').antwort)
  const h97 = bt.berichtEntpacken(fixture('report97-duesseldorf-2026-08.json').antwort)

  test('88: 34 Finanzwege, keine Abschnittsköpfe und keine Summenzeilen', () => {
    const fw = bt.finanzwege(h88)
    expect(fw).toHaveLength(34)
    expect(fw.some(z => z.name.startsWith('Gesamt'))).toBe(false)
    const g = new Map(fw.map(z => [z.nummer, z]))
    expect(g.get(3502)!.umsatz).toBeCloseTo(-4281.5, 2)
    expect(g.get(3502)!.anzahl).toBe(600)
    expect(g.get(3168)!.name).toBe('25% Glücksrad')
    expect(g.get(3501)!.name).toBe("25% Glücksrad'")
    expect(g.get(3502)!.abschnitt).toBe('Rabatte')
    expect(bt.finanzwegArt(g.get(3502)!.gruppe)).toBe('nachlass')
    expect(bt.finanzwegArt(g.get(41)!.gruppe)).toBe('zahlart')
  })

  test('88: LINAs Summe ist der Monatsumsatz des Betriebs (die Gegenprobe)', () => {
    expect(h88.balanceBrutto).toBeCloseTo(369841.09, 2)
    expect(h88.nBills).toBe(12186)
  })

  /**
   * DER BEFUND vom 22.09.2026 beim Bau: 97 liefert je Tag denselben
   * Finanzwegblock wie 88 — aus EINEM Monatsaufruf. Über den Monat summiert
   * gleichen sich alle 34 Finanzwege auf den Cent und die Anzahl genau.
   */
  /**
   * Gemessen beim Bau: 88 schreibt für einen Monatsaufruf `businessDate:
   * "01.08.2026"` — nur den ersten Tag. Ohne `proTag` bleibt der Tag leer,
   * und der Lader nimmt den Abrufzeitraum.
   */
  test('88: das Blockdatum ist kein Tag (nur der Erste eines Monatsaufrufs)', () => {
    expect(h88.bloecke[0]!.von).toBe('2026-08-01')
    expect(h88.bloecke[0]!.bis).toBe('2026-08-01')
    expect(bt.finanzwege(h88).every(z => z.geschaeftstag === null)).toBe(true)
  })

  test('97: die Tagesblöcke summieren sich genau zu 88', () => {
    const tage = bt.finanzwege(h97, true)
    expect(new Set(tage.map(z => z.geschaeftstag)).size).toBe(31)
    expect(tage.every(z => z.geschaeftstag !== null)).toBe(true)
    const summe = new Map<number, { u: number; a: number }>()
    for (const z of tage) {
      const s = summe.get(z.nummer) ?? { u: 0, a: 0 }
      s.u += z.umsatz ?? 0; s.a += z.anzahl ?? 0
      summe.set(z.nummer, s)
    }
    const monat = bt.finanzwege(h88)
    expect(summe.size).toBe(monat.length)
    for (const z of monat) {
      expect(Math.abs(summe.get(z.nummer)!.u - (z.umsatz ?? 0))).toBeLessThan(0.01)
      expect(summe.get(z.nummer)!.a).toBe(z.anzahl!)
    }
  })

  test('97: Hauptsparte × Steuersatz, brutto, Summe = balanceSumBrutto', () => {
    const z = bt.tagesabschlussSparten(h97)
    const summe = z.reduce((s, x) => s + x.brutto, 0)
    expect(summe).toBeCloseTo(369841.09, 2)
    expect(z[0]).toEqual({ geschaeftstag: '2026-08-01', hauptsparte: 'Getränke', steuersatz: '19%_Mwst', brutto: 12638 })
  })

  test('97 meldet interval 3 als einzig möglichen Wert', () => {
    expect(h97.intervalle).toEqual([3])
  })
})

describe('Rechnungsausgangsbuch (96), 15.08.2026', () => {
  const h = bt.berichtEntpacken(fixture('report96-duesseldorf-2026-08-15.json').antwort)
  const bons = bt.bons(h)

  test('519 Bons, alle am 15.08. — Berliner Mitternacht, nicht UTC', () => {
    expect(bons).toHaveLength(519)
    expect(new Set(bons.map(b => b.geschaeftstag))).toEqual(new Set(['2026-08-15']))
    expect(bons.map(b => b.laufnummer)).toEqual(Array.from({ length: 519 }, (_, i) => i + 1))
  })

  test('493 Rechnungen, 13 stornierte, 13 Gutschriften — und die Summe trifft LINAs Summe', () => {
    const art = (a: string) => bons.filter(b => b.art === a).length
    expect([art('Rechnung'), art('Stornierte Rechnung'), art('Gutschrift')]).toEqual([493, 13, 13])
    expect(bons.reduce((s, b) => s + (b.brutto ?? 0), 0)).toBeCloseTo(15920.61, 2)
    expect(h.balanceBrutto).toBeCloseTo(15920.61, 2)
  })

  test('Rechnungsnummer ist kein Schlüssel (neunmal 0)', () => {
    expect(bons.filter(b => b.rechnungsnummer === 0)).toHaveLength(9)
  })

  test('die eingerutschte Spaltenbeschriftung "Finanzwege" ist eine leere Liste', () => {
    expect(bons.some(b => b.finanzwege.includes('Finanzwege'))).toBe(false)
    expect(bons.filter(b => b.finanzwege.length === 0)).toHaveLength(20)
    expect(bons[0]!.finanzwege).toEqual(['Trinkgeld', 'VISA'])
  })

  test('keine Nachlass-Finanzwege in 96 (gemessen: 32 Glücksrad-Vorgänge in 88, null hier)', () => {
    expect(bons.some(b => b.finanzwege.some(f => f.includes('Glücksrad')))).toBe(false)
  })
})

describe('Stufe B: Spaltenpläne gegen die Stichproben der Vermessung', () => {
  const st = fixture('stufe-b-stichproben.json') as { berichte: Record<string, { antwort: unknown }> }
  const zeilen = (key: string) => bt.nachPlan(bt.berichtEntpacken(st.berichte[key]!.antwort), SPALTENPLAENE[key]!)

  test('jeder Stufe-B-Bericht hat einen Plan und eine Stichprobe', () => {
    expect(Object.keys(st.berichte).sort()).toEqual(Object.keys(SPALTENPLAENE).filter(k => k !== 'getReport:99').sort())
  })

  test('jede Stichprobe besteht das Schema ihres Berichts', () => {
    for (const [key, s] of Object.entries(st.berichte)) {
      const e = endpunkt(key) as any
      const r = betriebsberichtSchema(e.felder, e.dynamisch, e.intervall).safeParse(s.antwort)
      expect({ key, ok: r.success }).toEqual({ key, ok: true })
    }
  })

  test('61 und 53: die erste Zeile ist der Kopf eines Kellnerblocks', () => {
    const k61 = zeilen('getReport:61')
    expect(k61[0]).toMatchObject({ ist_kopf: true, kellner_block: 1, geschaeftstag: null })
    expect(k61[1]).toMatchObject({ ist_kopf: false, kellner_block: 1, geschaeftstag: '2026-08-01', brutto: 92 })
    const k53 = zeilen('getReport:53')
    expect(k53[0]).toMatchObject({ ist_kopf: true, artikelnummer: null })
    expect(k53[1]).toMatchObject({ ist_kopf: false, artikelnummer: 100002, anzahl_artikel: 5 })
  })

  test('75 und 76: die Sparte steht im Feld Zeitzone und wird zum Kontext', () => {
    const z = zeilen('getReport:76')
    expect(z[0]).toMatchObject({ ist_kopf: true, hauptsparte: 'Speisen' })
    expect(z[1]).toMatchObject({ ist_kopf: false, hauptsparte: 'Speisen', zeitzone: '9:00 - 12:00' })
  })

  test('57: "Anzahl Artikel" als Wert ist NULL, Kellner ohne Namen', () => {
    const z = zeilen('getReport:57')
    expect(z[0]).toMatchObject({ kellnernummer: 1169, kellner_name: null, anzahl_artikel: null,
                                  geschaeftstag: '2026-08-01', gutschriftnummer: 192132 })
  })

  test('86: die Summenzeile ohne Datum fällt weg', () => {
    const z = zeilen('getReport:86')
    expect(z).toHaveLength(1)
    expect(z[0]).toMatchObject({ geschaeftstag: '2026-08-15', rechnungsnummer: 1138062, finanzwege: ['Trinkgeld', 'VISA'] })
  })

  test('90: die wechselnden Steuersatzspalten landen im Rest, das Datum nicht', () => {
    const z = zeilen('getReport:90')
    expect(z[0]).toMatchObject({ geschaeftstag: '2026-08-01', brutto: 22282.34 })
    expect((z[0]!.steuersaetze as Record<string, unknown>)['19%_Mwst']).toBe(12638)
    expect('Datum' in (z[0]!.steuersaetze as object)).toBe(false)
  })

  test('99: eine Zeile je Zahlung wird je Betriebsstelle und Finanzweg verdichtet', () => {
    const h = bt.berichtEntpacken(fixture('report99-duesseldorf-2026-08-gekuerzt.json').antwort)
    const z = bt.nachPlan(h, SPALTENPLAENE['getReport:99']!)
    expect(z.reduce((s, x) => s + (x.zahlungen as number), 0)).toBe(320)
    const schluessel = z.map(x => `${x.betriebsstelle}|${x.finanzweg}`)
    expect(new Set(schluessel).size).toBe(schluessel.length)
  })
})

describe('Schema je Bericht', () => {
  const e92 = endpunkt('getReport:92') as any
  const b = r92.betriebe[1]!.antwort as any

  test('die echte Antwort besteht', () => {
    expect(betriebsberichtSchema(e92.felder, e92.dynamisch, e92.intervall).safeParse(b).success).toBe(true)
  })

  test('eine umbenannte Spalte fällt auf, statt als NULL durchzurutschen', () => {
    const umbenannt = structuredClone(b)
    umbenannt.tableHead[0][1].field = 'Artikelname'
    const r = betriebsberichtSchema(e92.felder, e92.dynamisch, e92.intervall).safeParse(umbenannt)
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error!.issues)).toContain('Spalte fehlt: Artikel')
  })

  test('ein Intervall, das LINA nicht kennt, fällt auf (LINA ignoriert es still)', () => {
    const r = betriebsberichtSchema(e92.felder, e92.dynamisch, 3).safeParse(b)
    expect(r.success).toBe(false)
  })
})
