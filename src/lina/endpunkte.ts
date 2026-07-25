/**
 * Berichtsregister.
 *
 * Eine Stelle, an der steht, welche LINA-Berichte wir holen, wie ihre
 * Parameter aussehen und in welcher Schrittweite sie eingereiht werden.
 * Neue Berichte sind ein Eintrag, kein Codeumbau.
 *
 * Die beiden Ebenen aus Phase 1 unterscheiden sich in mehr als der URL:
 *   Konzern  /intranet/analytics/...  alle 141 Betriebe je Antwort,
 *                                     Datum als 01.06.2026
 *   Betrieb  /finanzen/analytics/...  ein Betrieb je Antwort (storeId),
 *                                     Datum als 1.6.2026  (ohne führende Null)
 */
import { zuLinaDatum } from '../lib/time'

export type Ebene = 'konzern' | 'betrieb'
export type Schrittweite = 'tag' | 'monat' | 'jahr'

export type Endpunkt = {
  /** Schlüssel in der Warteschlange und in raw.api_antwort. */
  key: string
  ebene: Ebene
  pfad: string
  schrittweite: Schrittweite
  /** Baut die Query-Parameter für einen Zeitraum. */
  parameter: (von: string, bis: string, extra?: Record<string, string>) => Record<string, string>
  /** Kurzbeschreibung fürs Log und die Doku. */
  zweck: string
  aktiv: boolean
  hinweis?: string
}

/** Konzern-Ebene: DD.MM.YYYY mit führender Null. */
const konzernZeitraum = (von: string, bis: string) => ({
  von: zuLinaDatum(von),
  bis: zuLinaDatum(bis),
  reltime: 'custom',
  brutto: '0',
  preExistingRevenue: '0',
})

export const ENDPUNKTE: Endpunkt[] = [
  {
    key: 'getUmsatzbericht',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz, Rechnungen, Gäste, Durchschnittsbon je Betrieb',
    aktiv: true,
    parameter: (von, bis, extra = {}) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), ...extra,
    }),
  },
  {
    key: 'getUmsatzbericht:speisen',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Speisen',
    aktiv: true,
    hinweis: 'hauptsparten erwartet posId (10001), NICHT nummer — mit nummer kommt kommentarlos 0 EUR.',
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '10001',
    }),
  },
  {
    key: 'getUmsatzbericht:getraenke',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Getränke',
    aktiv: true,
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '10002',
    }),
  },
  {
    key: 'getPersonalkosten',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getPersonalkosten',
    schrittweite: 'tag',
    zweck: 'Personalkostenquoten, Effektivitäten, betriebsindividuelle Ampelschwellen',
    aktiv: true,
    parameter: (von, bis) => ({ report: 'intranet-personalkosten', ...konzernZeitraum(von, bis) }),
  },
  {
    key: 'getZeitzonenbericht',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getZeitzonenbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz je Stunde',
    aktiv: true,
    parameter: (von, bis) => ({ report: 'intranet-zeitzonen', ...konzernZeitraum(von, bis) }),
  },
  {
    key: 'getVordefinierteZeitzonenBericht',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getVordefinierteZeitzonenBericht',
    schrittweite: 'tag',
    zweck: 'Umsatz je vordefinierter Zeitzone (Frühstück, Mittag, Happy Hour, ...)',
    aktiv: true,
    parameter: (von, bis) => ({ report: 'intranet-vordefinierte-zeitzonen', ...konzernZeitraum(von, bis) }),
  },
  {
    key: 'getArtikelverkaufsbericht',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getArtikelverkaufsbericht',
    schrittweite: 'tag',
    zweck: 'Verkaufszahlen je Artikel und Betrieb, inkl. fixed_we und Verkaufspreisen',
    aktiv: true,
    hinweis: 'Größte Antwort, ca. 2 MB. Dominiert das Zeilenvolumen (~20 Mio./Jahr).',
    parameter: (von, bis) => ({ report: 'intranet-artikel', ...konzernZeitraum(von, bis) }),
  },
  {
    key: 'getAktionsbericht',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getAktionsbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz je Aktion',
    aktiv: true,
    parameter: (von, bis) => ({ report: 'intranet-aktion', ...konzernZeitraum(von, bis) }),
  },
  {
    key: 'getKennzahlen:absolut',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getKennzahlen',
    schrittweite: 'jahr',
    zweck: 'BWA in Euro: Umsatz, EBIT, WE Bar, WE Küche, Personalkosten ohne GF',
    aktiv: true,
    hinweis: 'Kein report-Parameter. Zwei Aufrufe je Jahr — die günstigste Historie im ganzen Projekt.',
    parameter: (von, bis) => ({ von: zuLinaDatum(von), bis: zuLinaDatum(bis), mode: 'absolut' }),
  },
  {
    key: 'getKennzahlen:relativ',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getKennzahlen',
    schrittweite: 'jahr',
    zweck: 'BWA in Prozent — liefert die Ampelwerte fertig',
    aktiv: true,
    hinweis: 'NICHT selbst aus den POS-Hauptsparten rechnen. Verifiziert: Bayreuth Mai 23,64/31,08/24,79 = Excel.',
    parameter: (von, bis) => ({ von: zuLinaDatum(von), bis: zuLinaDatum(bis), mode: 'relativ' }),
  },

  // --- Betriebs-Ebene: 141 Aufrufe je Zeitraum, deshalb sparsam ----------
  {
    key: 'getReport:38',
    ebene: 'betrieb',
    pfad: '/finanzen/analytics/getReport',
    schrittweite: 'monat',
    zweck: 'Stornobericht',
    aktiv: false,
    hinweis: 'Bewusst deaktiviert: Storno wird bei Concept Family nicht genutzt. Jeder geprüfte Betrieb '
           + 'lieferte nBillsGesamt = 0, während der Tagesabschluss desselben Betriebs volle Daten hat. '
           + 'Struktur ist dokumentiert, falls sich das ändert.',
    parameter: (von, bis) => ({
      report: '38', von: zuLinaDatum(von, 'short'), bis: zuLinaDatum(bis, 'short'),
      reltime: 'custom', interval: '8',
    }),
  },
  {
    key: 'getReport:107',
    ebene: 'betrieb',
    pfad: '/finanzen/analytics/getReport',
    schrittweite: 'monat',
    zweck: 'Gearbeitete Stunden je Betrieb — die Rohdaten hinter LINAs Effektivitäten',
    aktiv: true,
    hinweis:
      'Der einzige Weg an die Mitarbeiterstunden, ohne personenbezogene Stundenzettel zu scrapen. '
    + 'getPersonalkosten liefert nur fertige Effektivitäten; ohne diesen Bericht ist keine davon nachrechenbar. '
    + 'ACHTUNG: In Phase 1b antwortete 107 mit HTTP 500 und leerem Body — aber auf KONZERNEBENE, und '
    + '"CONCEPT FAMILY Franchise AG" ist eine Holding ohne eigene POS-Daten. Genau dieser Fehlschluss ist '
    + 'uns bei der BWA schon einmal passiert. Auf Betriebsebene mit storeId ist der Bericht ungetestet. '
    + 'Bleibt es auch dort bei 500, ist es ein Rechteproblem — dann in docs/offene-punkte.md vermerken und '
    + 'aktiv auf false setzen, NICHT in eine Wiederholungsschleife laufen lassen. '
    + 'Die Antwortstruktur ist unbekannt; bis zur ersten echten Antwort landet der Bericht nur in '
    + 'raw.api_antwort (default-Zweig in sync/laden.ts). Das ist Absicht, nicht Nachlässigkeit.',
    parameter: (von, bis) => ({
      report: '107', von: zuLinaDatum(von, 'short'), bis: zuLinaDatum(bis, 'short'),
      reltime: 'custom', interval: '8',
    }),
  },
  {
    key: 'getReport:23',
    ebene: 'betrieb',
    pfad: '/finanzen/analytics/getReport',
    schrittweite: 'monat',
    zweck: 'Personalkostenschätzung je Betrieb',
    aktiv: false,
    hinweis: 'Geschwister von 107. Erst aktivieren, wenn 107 auf Betriebsebene Daten liefert — '
           + 'sonst verdoppelt sich der Aufwand für dieselbe Erkenntnis.',
    parameter: (von, bis) => ({
      report: '23', von: zuLinaDatum(von, 'short'), bis: zuLinaDatum(bis, 'short'),
      reltime: 'custom', interval: '8',
    }),
  },
  {
    key: 'getReport:97',
    ebene: 'betrieb',
    pfad: '/finanzen/analytics/getReport',
    schrittweite: 'monat',
    zweck: 'Tagesabschluss je Betrieb',
    aktiv: false,
    hinweis: 'Erst ab Inbetriebnahme aktivieren, kein Backfill: 141 Aufrufe je Zeitraum.',
    parameter: (von, bis) => ({
      report: '97', von: zuLinaDatum(von, 'short'), bis: zuLinaDatum(bis, 'short'),
      reltime: 'custom', interval: '8',
    }),
  },
]

export const AKTIVE_ENDPUNKTE = ENDPUNKTE.filter(e => e.aktiv)

export function endpunkt(key: string): Endpunkt {
  const e = ENDPUNKTE.find(x => x.key === key)
  if (!e) throw new Error(`Unbekannter Endpunkt: ${key}`)
  return e
}
