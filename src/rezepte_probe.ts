/**
 * Rezept-Probe: liest FoodNotify, NUR GET, und belegt VOR dem ersten echten
 * Nachtlauf mit 0132, dass der Rezeptimport dort die erwartete Form bekommt.
 *
 *   bun run rezepte-probe                          alle Marken mit FN_*-Zugang
 *   bun run rezepte-probe --marke wilma_wunder --artikel 300203
 *   bun run rezepte-probe --aus belege/rezepte-probe/2026-10-15
 *
 * WAS ES TUT, je Marke:
 *   1. Listenseite 1 (`fn:rezepte`): Rohform, Paginierung, Rezeptzahl.
 *   2. Rezept A = erster Listeneintrag: Kopf, Zutaten, Meta.
 *      Rezept B = ein Rezept mit Unterrezept: hat A eines, ist B das
 *      Unterrezept selbst (der Weg über `/api/recipes/{id}` für Rezepte, die
 *      nicht in der Liste stehen); sonst werden die Zutaten der nächsten
 *      höchstens zwei Listeneinträge angesehen.
 *   3. Jede Antwort durch DIESELBE Prüfung wie der Importer:
 *      `rezeptStrukturFehler` plus `rezeptliste`/`rezeptKopf`/`rezeptZutaten`/
 *      `rezeptMeta`. Abweichung → oberste Schlüssel ausgeben, Exit-Code 1.
 *   4. Feldabgleich der Zutaten gegen die gemessenen Felder.
 *
 * WAS ES NICHT TUT: nichts in die Datenbank (kein raw, keine Warteschlange,
 * kein Tagesbudget aus sync.aufgabe), kein Schreiben bei FoodNotify, keine
 * anderen Pfade als die vier des Importers (dieselben `fnEndpunkt`-Einträge,
 * derselbe `FnClient`). Die Rohantworten gehen in ein Verzeichnis, das git
 * ignoriert — sonst bricht die Probe VOR dem ersten Aufruf ab.
 *
 * ANMELDUNG wie im Importer (`FnClient`/`FnSession`, FN_*-Variablen): je Marke
 * höchstens EIN Anmeldeversuch; scheitert er, wird die Marke übersprungen und
 * gemeldet (AGENTS.md Regel 7). Zugangsdaten werden nie ausgegeben.
 *
 * TEMPO: mindestens PAUSE_MS zwischen zwei Aufrufen, mehr, wenn FN_TAKT_*
 * größer ist (FnClient wartet zusätzlich auf seinen eigenen Takt). Höchstens
 * HOECHSTENS_AUFRUFE Rezeptaufrufe insgesamt (dazu je Marke die Anmeldung mit
 * /api/profile).
 *
 * EXIT-CODE: 0 alles in Form; 1 mindestens eine Form weicht ab; 2 keine
 * Abweichung, aber eine Marke ließ sich nicht prüfen (Anmeldung, Fehler).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fnGrenzen, fnZugaenge } from './config'
import { FnClient } from './foodnotify/client'
import { fnEndpunkt } from './foodnotify/endpunkte'
import { auspacken } from './foodnotify/huelle'
import { rezeptKopf, rezeptliste, rezeptMeta, rezeptStrukturFehler, rezeptZutaten } from './foodnotify/rezept'

export const PAUSE_MS = 1_000
export const HOECHSTENS_AUFRUFE = 32

/**
 * Die Zutatenfelder, gemessen an 7.452 Enchilada-Zeilen (foodnotify-api-inventar.md §3);
 * baseQuantity/baseUnit seit der Probe vom 15.10.2026 bekannt (core.zutat.basis_*).
 */
export const ZUTATENFELDER = ['id', 'kind', 'name', 'quantity', 'unit', 'baseQuantity', 'baseUnit',
  'cost', 'artikelId', 'supplier', 'subRecipeId', 'group'] as const

type Form = 'ok' | 'abweichend' | 'nicht geholt'

export type MarkenErgebnis = {
  marke: string
  anmeldung: 'ok' | 'gescheitert' | 'kein Zugang' | 'nicht versucht'
  rezepteGesamt: number | null
  listenseiten: number | null
  form: { liste: Form; kopf: Form; zutaten: Form; meta: Form }
  felder: { fehlend: string[]; neu: string[] } | null
  aufrufe: number
  befunde: string[]
  geprueft: { id: number; name: string; mitUnterrezept: boolean }[]
  artikelGefunden: { rezept: string; menge: unknown; einheit: unknown }[]
}

export type ProbeOptionen = {
  marken?: string[]
  artikel?: string
  aus: string
  /** Nur für Tests kleiner als PAUSE_MS. */
  pauseMs?: number
  hoechstens?: number
  ausgabe?: (zeile: string) => void
}

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Die obersten Schlüssel einer Antwort — und die der ausgepackten Daten. */
function formBeschreiben(roh: unknown): string {
  const oben = Array.isArray(roh) ? `Liste[${roh.length}]`
    : roh && typeof roh === 'object' ? `{${Object.keys(roh).join(', ')}}` : String(roh)
  const { daten, seiten } = auspacken(roh)
  const innen = Array.isArray(daten) ? `Liste[${daten.length}]`
    : daten && typeof daten === 'object' ? `{${Object.keys(daten).slice(0, 12).join(', ')}}` : String(daten)
  return `roh ${oben} → ausgepackt ${innen}${seiten ? ` · Seite ${seiten.aktuelleSeite}/${seiten.gesamtSeiten}, gesamt ${seiten.gesamt ?? '?'}` : ''}`
}

export async function rezepteProbe(o: ProbeOptionen): Promise<{ ergebnisse: MarkenErgebnis[]; exitCode: number }> {
  const aus = o.ausgabe ?? ((z: string) => console.log(z))
  const pause = Math.max(o.pauseMs ?? PAUSE_MS, 0)
  const grenze = o.hoechstens ?? HOECHSTENS_AUFRUFE
  const client = new FnClient()
  const zugaenge = fnZugaenge()
  const alleMarken = ['aposto', 'enchilada', 'deutsche_konzepte', 'wilma_wunder']
  const marken = o.marken?.length ? o.marken : alleMarken
  const unbekannt = marken.filter(m => !alleMarken.includes(m))
  if (unbekannt.length) throw new Error(`Unbekannte Marke: ${unbekannt.join(', ')} (erlaubt: ${alleMarken.join(', ')})`)

  let gesamtAufrufe = 0
  let letzter = 0
  const ergebnisse: MarkenErgebnis[] = []

  for (const marke of marken) {
    const e: MarkenErgebnis = {
      marke, anmeldung: 'nicht versucht', rezepteGesamt: null, listenseiten: null,
      form: { liste: 'nicht geholt', kopf: 'nicht geholt', zutaten: 'nicht geholt', meta: 'nicht geholt' },
      felder: null, aufrufe: 0, befunde: [], geprueft: [], artikelGefunden: [],
    }
    ergebnisse.push(e)
    if (!zugaenge.some(z => z.schluessel === marke)) {
      e.anmeldung = 'kein Zugang'
      e.befunde.push(`keine FN_*-Zugangsdaten für ${marke} — übersprungen`)
      continue
    }
    const verzeichnis = join(o.aus, marke)
    mkdirSync(verzeichnis, { recursive: true })

    /**
     * Ein Aufruf über denselben Client und dieselben Endpunkte wie der
     * Importer. null = nicht holbar (Grenze, Anmeldung, HTTP-Fehler) — der
     * Grund steht dann in e.befunde.
     */
    const holen = async (ep: string, p: Record<string, string>, datei: string): Promise<unknown | null> => {
      if (e.anmeldung === 'gescheitert') return null
      if (gesamtAufrufe >= grenze) {
        e.befunde.push(`Aufrufgrenze ${grenze} erreicht — ${ep} ${JSON.stringify(p)} nicht geholt`)
        return null
      }
      const warten = pause - (Date.now() - letzter)
      if (warten > 0) await schlaf(warten)
      gesamtAufrufe++; e.aufrufe++
      const res = await client.holen(fnEndpunkt(ep), marke, p)
      letzter = Date.now()
      if (res.art === 'gesperrt' && res.sperrArt === 'anmeldung') {
        e.anmeldung = 'gescheitert'
        // Die Meldung von FnSession nennt Marke und Status, nie Zugangsdaten.
        e.befunde.push(`Anmeldung gescheitert, Marke übersprungen: ${res.fehler}`)
        return null
      }
      e.anmeldung = 'ok'
      if (res.art !== 'ok') {
        e.befunde.push(`${ep} ${JSON.stringify(p)}: ${res.art} ${'fehler' in res ? res.fehler : ''}`.trim())
        return null
      }
      writeFileSync(join(verzeichnis, `${String(e.aufrufe).padStart(2, '0')}_${datei}.json`),
        JSON.stringify(res.daten, null, 1))
      return res.daten
    }

    /** Dieselbe Prüfung wie fnLaden: Formprüfung, dann die Transformation. */
    const pruefen = (ep: string, roh: unknown, feld: keyof MarkenErgebnis['form'], umwandeln: (r: unknown) => unknown) => {
      let fehler = rezeptStrukturFehler(ep, roh)
      if (!fehler) {
        try { umwandeln(roh) } catch (x) { fehler = String((x as Error).message ?? x) }
      }
      if (fehler) {
        e.form[feld] = 'abweichend'
        e.befunde.push(`${ep}: FORM WEICHT AB — ${fehler} · ${formBeschreiben(roh)}`)
      } else if (e.form[feld] !== 'abweichend') {
        e.form[feld] = 'ok'
      }
      return !fehler
    }

    const felderGesehen = new Set<string>()
    const zutatenPruefen = (roh: unknown, name: string) => {
      if (!pruefen('fn:rezept_zutaten', roh, 'zutaten', rezeptZutaten)) return [] as any[]
      const zeilen = auspacken(roh).daten as any[]
      for (const z of zeilen) for (const k of Object.keys(z ?? {})) felderGesehen.add(k)
      if (o.artikel) {
        for (const z of zeilen) {
          if (String(z?.artikelId ?? '') === o.artikel) {
            e.artikelGefunden.push({ rezept: name, menge: z.quantity, einheit: z.unit })
          }
        }
      }
      return zeilen
    }

    // 1. Listenseite 1
    const liste = await holen('fn:rezepte', { seite: '1' }, 'liste_seite1')
    if (liste === null) continue
    aus(`[${marke}] Liste: ${formBeschreiben(liste)}`)
    if (!pruefen('fn:rezepte', liste, 'liste', rezeptliste)) continue
    const { rezepte, seiten } = rezeptliste(liste)
    e.listenseiten = seiten.gesamtSeiten
    e.rezepteGesamt = seiten.gesamt ?? null
    if (seiten.gesamt === null) e.befunde.push('Liste ohne totalItems — Rezeptzahl unbekannt')
    if (rezepte.length === 0) { e.befunde.push('Listenseite 1 ist leer'); continue }

    // 2a. Rezept A — der erste Listeneintrag
    const rezeptVoll = async (id: number, name: string, mitZutaten: unknown | null) => {
      const kopf = await holen('fn:rezept', { rezeptId: String(id) }, `rezept_${id}_kopf`)
      if (kopf !== null) {
        if (kopf) aus(`[${marke}] Kopf ${id}: ${formBeschreiben(kopf)}`)
        pruefen('fn:rezept', kopf, 'kopf', rezeptKopf)
      }
      const zutatenRoh = mitZutaten ?? await holen('fn:rezept_zutaten', { rezeptId: String(id) }, `rezept_${id}_zutaten`)
      let zeilen: any[] = []
      if (zutatenRoh !== null) {
        aus(`[${marke}] Zutaten ${id}: ${formBeschreiben(zutatenRoh)}`)
        zeilen = zutatenPruefen(zutatenRoh, name)
      }
      const meta = await holen('fn:rezept_meta', { rezeptId: String(id) }, `rezept_${id}_meta`)
      if (meta !== null) {
        aus(`[${marke}] Meta ${id}: ${formBeschreiben(meta)}`)
        pruefen('fn:rezept_meta', meta, 'meta', rezeptMeta)
      }
      const mitUnterrezept = zeilen.some(z => z?.kind === 'sub_recipe')
      e.geprueft.push({ id, name, mitUnterrezept })
      return zeilen
    }

    const a = rezepte[0]!
    const zeilenA = await rezeptVoll(a.fnId, a.name, null)
    if (e.anmeldung === 'gescheitert') continue

    // 2b. Rezept B — mit Unterrezept
    const unterA = zeilenA.find(z => z?.kind === 'sub_recipe' && z?.subRecipeId != null)
    if (unterA) {
      // A hat ein Unterrezept: B ist dieses Unterrezept selbst — der Weg über
      // /api/recipes/{id}, den der Importer für Rezepte außerhalb der Liste geht.
      await rezeptVoll(Number(unterA.subRecipeId), String(unterA.name ?? ''), null)
    } else {
      let gefunden = false
      for (const r of rezepte.slice(1, 3)) {
        const roh = await holen('fn:rezept_zutaten', { rezeptId: String(r.fnId) }, `rezept_${r.fnId}_zutaten`)
        if (roh === null) break
        aus(`[${marke}] Zutaten ${r.fnId}: ${formBeschreiben(roh)}`)
        const zeilen = zutatenPruefen(roh, r.name)
        if (zeilen.some(z => z?.kind === 'sub_recipe')) {
          // Kopf und Meta noch dazu; die Zutaten sind schon da und geprüft.
          const kopf = await holen('fn:rezept', { rezeptId: String(r.fnId) }, `rezept_${r.fnId}_kopf`)
          if (kopf !== null) pruefen('fn:rezept', kopf, 'kopf', rezeptKopf)
          const meta = await holen('fn:rezept_meta', { rezeptId: String(r.fnId) }, `rezept_${r.fnId}_meta`)
          if (meta !== null) pruefen('fn:rezept_meta', meta, 'meta', rezeptMeta)
          e.geprueft.push({ id: r.fnId, name: r.name, mitUnterrezept: true })
          gefunden = true
          break
        }
        e.geprueft.push({ id: r.fnId, name: r.name, mitUnterrezept: false })
      }
      if (!gefunden) e.befunde.push('kein Rezept mit Unterrezept unter den ersten drei Listeneinträgen — nur Rezept A geprüft')
    }

    // 4. Feldabgleich
    if (felderGesehen.size > 0) {
      e.felder = {
        fehlend: ZUTATENFELDER.filter(f => !felderGesehen.has(f)),
        neu: [...felderGesehen].filter(f => !(ZUTATENFELDER as readonly string[]).includes(f)).sort(),
      }
    }
  }

  // Bericht
  const z = (x: unknown) => String(x ?? '—')
  aus('')
  aus('| Marke | Anmeldung | Rezepte gesamt | Seiten | Liste | Kopf | Zutaten | Meta | Felder | Aufrufe |')
  aus('|---|---|---|---|---|---|---|---|---|---|')
  for (const e of ergebnisse) {
    const felder = e.felder === null ? '—'
      : e.felder.fehlend.length === 0 && e.felder.neu.length === 0 ? 'wie gemessen'
      : [e.felder.fehlend.length ? `fehlt: ${e.felder.fehlend.join(', ')}` : '',
         e.felder.neu.length ? `neu: ${e.felder.neu.join(', ')}` : ''].filter(Boolean).join('; ')
    aus(`| ${e.marke} | ${e.anmeldung} | ${z(e.rezepteGesamt)} | ${z(e.listenseiten)} | ${e.form.liste} | `
      + `${e.form.kopf} | ${e.form.zutaten} | ${e.form.meta} | ${felder} | ${e.aufrufe} |`)
  }
  for (const e of ergebnisse) {
    if (e.geprueft.length) {
      aus(`\n${e.marke}: geprüft ${e.geprueft.map(g => `${g.id} „${g.name}"${g.mitUnterrezept ? ' (mit Unterrezept)' : ''}`).join(', ')}`)
    }
    for (const b of e.befunde) aus(`${e.marke}: ${b}`)
    if (o.artikel && e.anmeldung === 'ok') {
      aus(`${e.marke}: Artikel ${o.artikel} in den ${e.geprueft.length} geprüften Rezepten: `
        + (e.artikelGefunden.length
          ? e.artikelGefunden.map(f => `${f.rezept} (${f.menge} ${f.einheit})`).join(', ')
          : 'nicht gefunden')
        + ` — KEINE vollständige Suche (Rezepte gesamt: ${z(e.rezepteGesamt)}).`)
    }
  }
  aus(`\nRezeptaufrufe gesamt: ${gesamtAufrufe} (Grenze ${grenze}), Pause ≥ ${pause} ms, `
    + `FN_TAKT ${fnGrenzen().taktMin}–${fnGrenzen().taktMax} ms. Rohantworten: ${o.aus}`)

  const abweichung = ergebnisse.some(e => Object.values(e.form).includes('abweichend'))
  const ungeprueft = ergebnisse.some(e => e.anmeldung === 'gescheitert'
    || (e.anmeldung === 'ok' && (e.form.liste !== 'ok' || e.befunde.some(b => b.includes(': fehler')))))
  return { ergebnisse, exitCode: abweichung ? 1 : ungeprueft ? 2 : 0 }
}

/** Liegt das Verzeichnis in einem Pfad, den git ignoriert? Sonst kein Aufruf. */
export function gitIgnoriert(pfad: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', join(pfad, 'probe.json')], { stdio: 'ignore' })
    return true
  } catch { return false }
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
  const datum = new Date().toISOString().slice(0, 10)
  const ziel = resolve(arg('aus') ?? join('belege', 'rezepte-probe', datum))
  if (!gitIgnoriert(ziel)) {
    console.error(`Abbruch vor dem ersten Aufruf: ${ziel} ist nicht von git ignoriert. `
      + 'Rohantworten gehören nicht ins Repository — ein Verzeichnis unter belege/ wählen.')
    process.exit(3)
  }
  const marke = arg('marke')
  const { exitCode } = await rezepteProbe({
    marken: marke ? [marke] : undefined, artikel: arg('artikel'), aus: ziel,
  })
  process.exit(exitCode)
}
