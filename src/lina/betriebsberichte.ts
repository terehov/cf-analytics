/**
 * Das Register der Betriebsberichte — LINAs 72 Berichte je Betrieb.
 *
 * WARUM EIN EIGENES REGISTER UND NICHT `ENDPUNKTE`. Jeder aktive Eintrag in
 * `ENDPUNKTE` speist die Konzern-Einreihzweige (`linaNachfuellen()`,
 * `historieNachziehen()`, die Nulltage, die Nachlese) — und die kennen keinen
 * Betrieb. Ein Betriebsbericht dort liefe ohne `laden=` los, ohne Fehler
 * (genau das fand der Wächter am 13.08.2026). Eingereiht werden die Einträge
 * hier ausschließlich von `betriebsberichteNachfuellen()`, je Betrieb und
 * Zeitraum. Dieselbe Trennung wie bei der Ladenakte (`LADENAKTE_ENDPUNKTE`).
 *
 * DER ENDPUNKT (KORREKTUR 7, 22.09.2026). Nicht `/finanzen/analytics/getReport`
 * mit `storeId=` — der antwortet mit 200 und leeren Gerüsten, für jeden Betrieb
 * und jeden Zeitraum, zwei Monate lang als „gelöst" geführt. Sondern
 *
 *   GET /intranet/storeanalytics/getReport
 *       ?report=<id>&von=1.8.2026&bis=31.8.2026&reltime=custom&interval=<n>&laden=<encId>
 *
 * `laden` ist die `encId` aus dem Umsatzbericht (`core.betrieb.enc_id`), alle
 * 141 Betriebe mit einer Sitzung, kein Mandantenwechsel. Datum OHNE führende
 * Nullen (anders als die Konzernebene). Die Antwort ist teils doppelt
 * JSON-kodiert (ein String, der JSON enthält).
 *
 * DIE FENSTERKLASSEN (docs/plan-lina-vollabzug.md, Abschnitt 3) bestimmen den
 * Zeitraum eines Postens — und damit Faktor 30 in den Kosten:
 *
 *   T      Tagesaufruf (von = bis). Bericht kennt nur „Kumuliert" und hat keine
 *          Datumsspalte: 92, 88.
 *   W      sieben Tage, NIE länger. Ein Monatsaufruf läuft in 504 Gateway
 *          Timeout (970-kB-HTML-Fehlerseite), sieben Tage in 2,9 s: 96, 86, 113.
 *          Wird es trotzdem zu groß, halbiert der Worker das Fenster.
 *   M-Tag  Monatsaufruf, die Zeilen tragen ein Datum: 97 (interval=3), 90, 108, 61.
 *   M      Monatsaufruf, Monatszeile(n): alles Übrige.
 */
import type { Endpunkt } from './endpunkte'
import { zuLinaDatum } from '../lib/time'

export type Fensterklasse = 'T' | 'W' | 'M-Tag' | 'M'

export type Betriebsbericht = Endpunkt & {
  ebene: 'betrieb'
  /** LINAs Berichtsnummer aus `reportList`. */
  bericht: number
  klasse: Fensterklasse
  /**
   * Das angefragte `interval`. LINA IGNORIERT ein nicht unterstütztes still
   * (getestet: interval=3 gegen 88 → identische Bytes, defaultInterval 8).
   * Deshalb prüft das Schema, dass die Antwort den Wert in `possibleIntervals`
   * führt — sonst sähen Monatszeilen aus wie Tageszeilen.
   */
  intervall: 3 | 8
  /** `tableHead[].field`, die jede Antwort tragen MUSS (Vermessung 22.09.2026). */
  felder: readonly string[]
  /** Zusätzliche Felder, die erlaubt sind — die Steuersatzspalten wechseln je Betrieb. */
  dynamisch?: RegExp
  stufe: 'A' | 'B'
  /** Wohin der Lader schreibt — für Wächter, Doku und die nächste Person. */
  tabellen: readonly string[]
}

const BERICHT_PFAD = '/intranet/storeanalytics/getReport'

/** Parameter eines Betriebsberichts. `laden` setzt der Worker aus dem Posten. */
const berichtParameter = (bericht: number, intervall: number) =>
  (von: string, bis: string): Record<string, string> => ({
    report: String(bericht),
    von: zuLinaDatum(von, 'short'),
    bis: zuLinaDatum(bis, 'short'),
    reltime: 'custom',
    interval: String(intervall),
  })

const SCHRITT: Record<Fensterklasse, Endpunkt['schrittweite']> = {
  T: 'tag', W: 'woche', 'M-Tag': 'monat', M: 'monat',
}

type Eintrag = {
  bericht: number; klasse: Fensterklasse; intervall?: 3 | 8; stufe: 'A' | 'B'
  zweck: string; felder: readonly string[]; dynamisch?: RegExp
  tabellen: readonly string[]; aktiv?: boolean; hinweis?: string
}

/** Die Steuersatzspalten (19%_Mwst, 0%_Gutschein_older, NEUE_STEUER_AB_15, …). */
const STEUERSPALTEN = /mwst|%|steuer|keine_zuordnung/i

function bb(e: Eintrag): Betriebsbericht {
  const intervall = e.intervall ?? 8
  return {
    key: `getReport:${e.bericht}`,
    ebene: 'betrieb',
    pfad: BERICHT_PFAD,
    schrittweite: SCHRITT[e.klasse],
    parameter: berichtParameter(e.bericht, intervall),
    zweck: e.zweck,
    aktiv: e.aktiv ?? true,
    hinweis: e.hinweis,
    doppeltKodiert: true,
    betriebParameter: 'laden',
    bericht: e.bericht,
    klasse: e.klasse,
    intervall,
    felder: e.felder,
    dynamisch: e.dynamisch,
    stufe: e.stufe,
    tabellen: e.tabellen,
  }
}

export const BETRIEBSBERICHTE: Betriebsbericht[] = [
  // --- Stufe A: täglich bzw. im kleinsten Raster, rückwärts bis 2018 ------
  bb({
    bericht: 92, klasse: 'T', stufe: 'A',
    zweck: 'Rabattbericht: Nachlass je Finanzweg (Hausbon/Rabatt) und Artikelname',
    felder: ['Rabatt', 'Artikel', 'Brutto', 'Netto', 'Anzahl'],
    tabellen: ['core.rabatt_artikel_tag'],
    hinweis: 'Artikel nur mit NAMEN, keine Nummer. Brutto/Netto sind der gewaehrte Nachlass '
           + '(negativ). Der Nachlass gilt fuer den ganzen Bon, nicht fuer den Artikel.',
  }),
  bb({
    bericht: 88, klasse: 'T', stufe: 'A',
    zweck: 'Finanzwege je Betrieb und Tag, dazu der Finanzweg-Stamm',
    felder: ['Nummer', 'Finanzweg', 'Finanzgruppe', 'Umsatz', 'Anzahl'],
    tabellen: ['core.finanzweg_tag', 'core.finanzweg', 'core.finanzweg_stand'],
    hinweis: 'Anzahl zaehlt VORGAENGE (600 bei 50 % Gluecksrad), in 92 zaehlt sie ARTIKEL (712). '
           + 'Bericht 97 liefert dieselbe Tabelle je Tag aus einem Monatsaufruf — gemessen '
           + '22.09.2026, alle 34 Finanzwege auf den Cent gleich (docs/lina-api-korrekturen.md).',
  }),
  bb({
    bericht: 96, klasse: 'W', stufe: 'A',
    zweck: 'Rechnungsausgangsbuch: eine Zeile je Bon (ohne Uhrzeit, ohne Nachlaesse)',
    felder: ['Datum', 'Rechnungsnummer', 'Rechnung/Butschrift', 'Anzahl_Artikel', 'Finanzwege',
             'Brutto', 'Debitor_-_Anschrift', 'Debitor'],
    tabellen: ['core.bon'],
  }),
  bb({
    bericht: 97, klasse: 'M-Tag', intervall: 3, stufe: 'A',
    zweck: 'Tagesabschluss: je Tag Hauptsparte × Steuersatz und die volle Finanzwegtabelle',
    felder: ['Hauptsparte', 'Nummer', 'Finanzweg', 'Finanzgruppe', 'Umsatz', 'Anzahl'],
    dynamisch: STEUERSPALTEN,
    tabellen: ['core.tagesabschluss_tag', 'core.finanzweg_tag'],
    hinweis: 'possibleIntervals fuehrt nur 3 "pro Tag". Je Tag zwei Bloecke: Hauptsparte × '
           + 'Steuersatz (brutto) und die Finanzwegtabelle wie in Bericht 88.',
  }),

  // --- Stufe B: monatlich, soweit nicht anders gemessen ---------------------
  bb({
    bericht: 39, klasse: 'M', stufe: 'B',
    zweck: 'Stornogrundbericht: Artikel × Stornotyp × Stornogrund (enthaelt 38 vollstaendig)',
    felder: ['Artikelnummer', 'Artikel', 'Stornotyp', 'Stornogrund', 'Anzahl', 'Umsatz_Brutto', 'Umsatz_Netto'],
    tabellen: ['core.storno_artikel_monat'],
  }),
  bb({
    bericht: 90, klasse: 'M-Tag', stufe: 'B',
    zweck: 'Monatsaufstellung Tag fuer Tag: Anzahl, Brutto, Netto, USt, Steuersaetze',
    felder: ['Datum', 'Anzahl', 'Brutto', 'Netto', 'Ust'],
    dynamisch: STEUERSPALTEN,
    tabellen: ['core.monatsaufstellung_tag'],
  }),
  bb({
    bericht: 108, klasse: 'M-Tag', stufe: 'B',
    zweck: 'Verkaufszahlen je Tag: Brutto, Artikel, Zahlungen, Rechnungen',
    felder: ['Betrieb', 'Datum', 'Brutto', 'Anzahl_Artikel', 'Anzahl_Zahlungen', 'Anzahl_Rechnungen'],
    tabellen: ['core.verkaufszahlen_tag'],
  }),
  bb({
    bericht: 99, klasse: 'M', stufe: 'B',
    zweck: 'Unbare Zahlungen nach Betriebsstelle (Entscheidung E6)',
    felder: ['Betriebsstelle', 'Finanzweg', 'Saldo', 'Anzahl'],
    tabellen: ['core.unbar_zahlung_monat'],
    hinweis: 'Eine Zeile je ZAHLUNG ohne Datum und ohne Kennung (8.780 im August bei Duesseldorf, '
           + '2,1 MB). core verdichtet je Betriebsstelle und Finanzweg; die Einzelzahlungen stehen in raw.',
  }),
  // Kellnerberichte (Entscheidung E5). LINA liefert die Kellnernummer, der Name ist null.
  bb({
    bericht: 60, klasse: 'M', stufe: 'B',
    zweck: 'Umsatz pro Kellner',
    felder: ['Kellnernummer', 'Kellner', 'Brutto', 'Netto', 'Anzahl_Artikel', 'Trinkgeld'],
    tabellen: ['core.kellner_umsatz_monat'],
  }),
  bb({
    bericht: 61, klasse: 'M-Tag', stufe: 'B',
    zweck: 'Umsatz pro Kellner pro Tag (Kellnerbloecke ohne Kellnernummer)',
    felder: ['Tag', 'Brutto', 'Netto', 'Anzahl_Artikel', 'Trinkgeld'],
    tabellen: ['core.kellner_umsatz_tag'],
    hinweis: 'Kein Kellnerfeld: je Kellner eine Kopfzeile (Tag leer), darunter seine Tage. Die '
           + 'Kellnernummer steht nicht in der Antwort — Struktur an einem zweiten Betrieb bestaetigen.',
  }),
  bb({
    bericht: 53, klasse: 'M', stufe: 'B',
    zweck: 'Artikelbericht pro Kellner (Kellnerbloecke ohne Kellnernummer)',
    felder: ['Artikelnummer', 'Artikelname', 'Brutto', 'Netto', 'Anzahl_Artikel'],
    tabellen: ['core.kellner_artikel_monat'],
    hinweis: '1,88 MB je Betrieb-Monat, groesste Antwort im Katalog. Kopfzeile je Kellner '
           + '(Artikelnummer leer) ohne Kellnernummer.',
  }),
  bb({
    bericht: 57, klasse: 'M', stufe: 'B',
    zweck: 'Gutschriften pro Kellner: eine Zeile je Gutschrift',
    felder: ['Kellnernummer', 'Kellner', 'Datum', 'Gutschriftnummer', 'Rechnungsnummer', 'Anzahl_Artikel', 'Brutto'],
    tabellen: ['core.gutschrift_kellner'],
  }),
  bb({
    bericht: 68, klasse: 'M', stufe: 'B',
    zweck: 'Umsatz nach Betriebsstellen',
    felder: ['Betriebsstelle', 'Umsatz_Brutto', 'Umsatz_Netto', 'Anzahl_Artikel', 'Anzahl_Gäste', 'Pro_Kopf_Netto'],
    tabellen: ['core.betriebsstelle_umsatz_monat'],
  }),
  bb({
    bericht: 69, klasse: 'M', stufe: 'B',
    zweck: 'Umsatz nach Betriebsstellen und Hauptsparten',
    felder: ['Betriebsstelle', 'Hauptsparte', 'Umsatz_Brutto', 'Umsatz_Netto', 'Anzahl_Artikel'],
    tabellen: ['core.betriebsstelle_hauptsparte_monat'],
  }),
  bb({
    bericht: 112, klasse: 'M', stufe: 'B',
    zweck: 'Umsatz nach Verkaufsstelle',
    felder: ['Verkaufsstelle', 'Umsatz_Brutto', 'Umsatz_Netto', 'Anzahl', 'Anzahl_Gäste', 'Pro_Kopf_Netto'],
    tabellen: ['core.verkaufsstelle_umsatz_monat'],
  }),
  bb({
    bericht: 71, klasse: 'M', stufe: 'B',
    zweck: 'Umsatz nach Verkaufsstelle und Hauptsparte',
    felder: ['Verkaufsstelle', 'Hauptsparte', 'Anzahl', 'Umsatz_Brutto', 'Umsatz_Netto'],
    tabellen: ['core.verkaufsstelle_hauptsparte_monat'],
  }),
  bb({
    bericht: 75, klasse: 'M', stufe: 'B',
    zweck: 'Zeitzonen × Feinsparte (vordefinierte Zeitzonen)',
    felder: ['Zeitzone', 'Brutto', 'Netto', 'Durchschnitt_pro_Tag'],
    tabellen: ['core.zeitzone_feinsparte_monat'],
    hinweis: 'Spalte Zeitzone traegt abwechselnd die Sparte (Kopfzeile) und das Zeitfenster '
           + '("9:00 - 12:00"). Nur aus zwei Beispielzeilen abgelesen — an einem zweiten Betrieb bestaetigen.',
  }),
  bb({
    bericht: 76, klasse: 'M', stufe: 'B',
    zweck: 'Zeitzonen × Hauptsparte (vordefinierte Zeitzonen)',
    felder: ['Zeitzone', 'Brutto', 'Netto', 'Durchschnitt_pro_Tag'],
    tabellen: ['core.zeitzone_hauptsparte_monat'],
    hinweis: 'Wie 75. Januar 2022 lieferte 500 mit leerem Rumpf, waehrend 43 Daten hatte.',
  }),
  bb({
    bericht: 86, klasse: 'W', stufe: 'B',
    zweck: 'Debitorenauswertung: eine Zeile je Bon mit Debitorfeldern',
    felder: ['Datum', 'Rechnungsnummer', 'Rechnung/Gutschrift', 'Anzahl_Artikel', 'Finanzwege',
             'Brutto', 'Debitor_-_Anschrift', 'Debitor'],
    tabellen: ['core.debitor_bon'],
    hinweis: 'Am Tagesaufruf 15.08.2026 dieselben 519 Bons wie 96, nur mit Summenzeile — '
           + 'moeglicherweise ein Duplikat von 96. An einem Betrieb MIT Debitoren pruefen.',
  }),
  bb({
    bericht: 113, klasse: 'W', stufe: 'B',
    zweck: 'Tischtransfer: eine Zeile je Bon mit TischId',
    felder: ['Datum', 'Rechnungsnummer', 'TischId', 'Rechnung/Butschrift', 'Anzahl_Artikel',
             'Finanzwege', 'Brutto', 'Status', 'Versuche', 'Antwort'],
    tabellen: ['core.tischtransfer_bon'],
  }),

  // --- Registriert, aber aus: kein Posten, kein Backfill -------------------
  bb({
    bericht: 38, klasse: 'M', stufe: 'B', aktiv: false,
    zweck: 'Stornobericht',
    felder: ['Artikelnummer', 'Artikel', 'Stornotyp', 'Anzahl', 'Umsatz_Brutto', 'Umsatz_Netto'],
    tabellen: [],
    hinweis: 'Nicht geladen: 39 enthaelt 38 vollstaendig plus den Stornogrund (gleiche Summen, '
           + 'gemessen 22.09.2026, Entscheidung E3).',
  }),
  bb({
    bericht: 114, klasse: 'M', stufe: 'B', aktiv: false,
    zweck: 'Mitarbeiter Verpflegung / Kost-Sach-Bezug',
    felder: ['Personalnummer', 'Mitarbeiter_Vorname', 'Mitarbeiter_Nachname', 'Datum_/_Uhrzeit',
             'Anzahl_Artikel', 'Kost-Sach-Bezug', 'Saldo_(Brutto)'],
    tabellen: [],
    hinweis: 'Fuer Duesseldorf/August echt leer. Vor dem Backfill an drei weiteren Betrieben messen '
           + '(docs/offene-punkte.md) — sonst 5.115 Aufrufe fuer Leerzeilen.',
  }),
  bb({
    bericht: 81, klasse: 'M', stufe: 'B', aktiv: false,
    zweck: 'Gutscheine im Umlauf (Bestand, kein Zeitraum)',
    felder: ['Gutscheinnummer', 'Erstellt', 'Erste_Transaktion', 'Letzte_Transaktion', 'Saldo', 'Anzahl_Transaktionen'],
    tabellen: [],
    hinweis: 'Duesseldorf: 200 mit 0 Zeilen. An einem Betrieb mit Gutscheinumsatz messen, bevor '
           + 'F5 gebaut oder verworfen wird.',
  }),
  bb({
    bericht: 82, klasse: 'M', stufe: 'B', aktiv: false,
    zweck: 'Gutscheintransaktionen',
    felder: ['Gutscheinnummer', 'Startguthaben', 'Erstellt', 'Transaktionszeitpunkt', 'Betrag'],
    tabellen: [],
    hinweis: 'Wie 81: Duesseldorf 200 mit 0 Zeilen, erst an einem Betrieb mit Gutscheinen messen.',
  }),
  bb({
    bericht: 107, klasse: 'M', stufe: 'B', aktiv: false,
    zweck: 'Gearbeitete Stunden',
    felder: [],
    tabellen: [],
    hinweis: 'HTTP 500 mit leerem Rumpf — auch ueber laden= (Vermessung E4, 22.09.2026). Nicht '
           + 'unterscheidbar, ob gesperrt oder leer. Dasselbe fuer 2, 3, 7, 8, 9, 23, 24, 118.',
  }),
  bb({
    bericht: 23, klasse: 'M', stufe: 'B', aktiv: false,
    zweck: 'Personalkostenschaetzung',
    felder: [],
    tabellen: [],
    hinweis: 'Wie 107: 500 mit leerem Rumpf auch ueber laden= (E4).',
  }),
]

export const AKTIVE_BETRIEBSBERICHTE = BETRIEBSBERICHTE.filter(b => b.aktiv)

export function istBetriebsbericht(key: string): boolean {
  return key.startsWith('getReport:')
}

export function betriebsbericht(key: string): Betriebsbericht | undefined {
  return BETRIEBSBERICHTE.find(b => b.key === key)
}
