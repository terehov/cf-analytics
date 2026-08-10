/**
 * Importer fuer Online-Bewertungen.
 *
 *     bun run yext                  letzte 3 Monate    (der taegliche Lauf)
 *     bun run yext --voll           letzte 25 Monate   (Erstbefuellung)
 *     bun run yext --monate=12      eigenes Fenster
 *     bun run yext --trocken        nur zeigen, nichts schreiben
 *     bun run yext --ohne-texte     nur die Kennzahl, keine Einzelbewertungen
 *     bun run yext --ohne-analytics ohne Themen, Antwortverhalten, Sichtbarkeit
 *     bun run yext --portal=ALLE    andere Kennzahlbasis eintragen
 *
 * WARUM DER TAEGLICHE LAUF NUR DREI MONATE HOLT. Ein Stand ist kumuliert;
 * der Stand vom Maerz aendert sich nicht mehr, wenn im August eine Bewertung
 * dazukommt. Was sich noch bewegt, ist der laufende Monat — und der Vormonat,
 * weil Portale Bewertungen verzoegert durchreichen. Drei Monate decken das mit
 * Reserve ab und kosten rund 400 Aufrufe statt 3.300.
 *
 * Geloeschte Bewertungen aendern allerdings auch alte Staende. Dafuer ist
 * `--voll` da: einmal im Monat gefahren, zieht es die ganze Reihe gerade. Der
 * Import ist durchgehend ein Upsert, ein zweiter Lauf korrigiert also einfach
 * den ersten.
 *
 * 25 statt 24 Monate ist kein Vertippen: der aelteste geladene Monat hat
 * keinen Vormonat und damit keinen Monatswert (siehe mart.bewertung_verlauf).
 * Ein Monat Vorlauf macht die berichteten 24 vollstaendig.
 */
import { config } from './config'
import { log } from './lib/log'
import { yextKonfiguriert } from './yext/client'
import { staendeLaden, bewertungenLaden, kennzahlFuellen, laufMerken, monate, pool } from './yext/laden'
import { analyticsLaden } from './yext/analytics'

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
const hat = (name: string) => process.argv.includes(`--${name}`)

const monateAnzahl = Number(arg('monate') ?? (hat('voll') ? 25 : 3))
const trocken = hat('trocken')
const publisher = arg('portal') ?? 'GOOGLEMYBUSINESS'

if (!yextKonfiguriert()) {
  log.error('YEXT_API_KEY ist nicht gesetzt — siehe .env.example, Abschnitt Yext')
  process.exit(1)
}
if (!Number.isFinite(monateAnzahl) || monateAnzahl < 1) {
  log.error('--monate braucht eine Zahl ab 1', { wert: arg('monate') })
  process.exit(1)
}

const fenster = monate(monateAnzahl)
log.info('yext-importer', {
  instanz: config.YEXT_BASE_URL, konto: config.YEXT_ACCOUNT_ID,
  fenster: `${fenster.at(-1)?.erster} bis ${fenster[0]?.erster}`,
  kennzahlPortal: publisher, trocken,
})

const t0 = Date.now()
try {
  const erg = await staendeLaden({ monateAnzahl, trocken })

  let kennzahl = 0
  if (!trocken && erg.betriebe > 0) kennzahl = await kennzahlFuellen(publisher)

  // Die einzelnen Bewertungen NACH den Staenden: die Kennzahl ist die
  // Arbeit, die Texte sind die Begruendung dazu. Bricht der Lauf hier ab,
  // steht die Ampel trotzdem schon richtig.
  if (!trocken && !hat('ohne-texte')) {
    const t = await bewertungenLaden({ voll: hat('voll') })
    log.info('einzelbewertungen', {
      betriebe: t.betriebe, aufrufe: t.aufrufe, zeilen: t.zeilen, fehler: t.fehler.length,
    })
    erg.aufrufe += t.aufrufe
    erg.fehler.push(...t.fehler)
  }

  // Analytics ZULETZT, aus demselben Grund, aus dem die Texte nach den
  // Staenden kommen: die Ampel ist die Arbeit, die Themen sind die
  // Begruendung dazu. Bricht es hier ab, steht der Round Table trotzdem.
  //
  // IMMER 25 MONATE, unabhaengig von --monate. Ein Analytics-Bericht
  // kostet einen Aufruf, egal wie viele Monate er umspannt -- ein
  // kleineres Fenster spart hier nichts und liesse nur Luecken in den
  // Sichtbarkeitsreihen zurueck, die niemand nachtraeglich fuellt.
  if (!hat('ohne-analytics')) {
    const a = await analyticsLaden({ monateAnzahl: Math.max(monateAnzahl, 25), trocken })
    erg.aufrufe += a.aufrufe
  }

  const dauer = Math.round((Date.now() - t0) / 1000)
  log.info('fertig', {
    betriebe: erg.betriebe, aufrufe: erg.aufrufe, zeilen: erg.zeilen,
    kennzahlZeilen: kennzahl, fehler: erg.fehler.length,
    dauerS: dauer, proAufrufMs: erg.aufrufe ? Math.round((Date.now() - t0) / erg.aufrufe) : 0,
  })

  if (erg.fehler.length) {
    // Sichtbar, aber nicht toedlich: ein Standort ohne Antwort darf die
    // anderen 65 nicht mitnehmen. Wer hinsieht, soll trotzdem wissen, wer.
    log.warn('mit Fehlern beendet', { anzahl: erg.fehler.length, fehler: erg.fehler.slice(0, 10) })
  }

  if (!trocken) await laufMerken(erg, kennzahl, publisher)
  process.exitCode = erg.fehler.length && erg.betriebe === erg.fehler.length ? 1 : 0
} catch (e) {
  log.error('yext-importer abgebrochen', { fehler: String((e as Error).message).slice(0, 400) })
  process.exitCode = 1
} finally {
  await pool.end()
}
