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

export type Ebene = 'konzern' | 'betrieb' | 'stamm'
export type Schrittweite = 'tag' | 'monat' | 'jahr' | 'momentaufnahme'

/**
 * Momentaufnahmen sind etwas grundsätzlich anderes als Berichte.
 *
 * Ein Bericht für den 14.06.2023 liefert heute dasselbe wie in fünf Jahren —
 * der Tag ist ein abgeschlossener Fakt. Stammdaten dagegen **überschreibt**
 * LINA: Einkaufspreise, Warengruppen und Lieferantenzuordnungen kennen keine
 * Historie. `prices[].updated` verrät nur, wann zuletzt geändert wurde, nicht
 * was vorher galt.
 *
 * Daraus folgen drei Regeln, die im Code an mehreren Stellen auftauchen:
 *   * `parameter()` bekommt **keine** Datumsangaben — es gibt nur „jetzt".
 *   * Eingereiht wird **monatlich** zum Monatsersten, nicht täglich.
 *   * **Kein Backfill.** `--historie` überspringt sie; rückwärts existieren
 *     diese Daten nicht und sind auch nicht nachholbar.
 *
 * `sync.warteschlange` verlangt `zeitraum_von`/`zeitraum_bis` als NOT NULL.
 * Beide stehen deshalb auf dem Monatsersten — damit greift der vorhandene
 * Eindeutigkeitsindex und dieselbe Momentaufnahme wird nicht zweimal geholt.
 */
export const istMomentaufnahme = (e: Endpunkt) => e.schrittweite === 'momentaufnahme'

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
    aktiv: false,
    hinweis:
      'AM 25.07.2026 IM BROWSER VERIFIZIERT: nicht verfügbar. Der Bericht antwortet mit HTTP 500 und '
    + 'leerem Body — auf BETRIEBSEBENE mit storeId, für den umsatzstärksten Betrieb, und für drei '
    + 'verschiedene Zeiträume (Mai 2026, März 2026, Gesamtjahr 2025). Meine Holding-Hypothese war also '
    + 'falsch. Dass es kein Datenproblem ist, zeigt der Gegentest: Bericht 97 (Tagesabschluss) und 114 '
    + '(Kost-Sach-Bezug) liefern für denselben Betrieb und dieselben Parameter sauberes JSON. '
    + 'Dasselbe Bild bei 7, 8, 9, 23, 24 und 118 — die gesamte Personal- und Wareneinsatzgruppe ist für '
    + 'diesen Account gesperrt oder nicht lizenziert. '
    + 'NICHT auf true stellen, ohne dass jemand die Rechte bei LINA geklärt hat: aktiviert kostet der '
    + 'Bericht rund 8.500 Anfragen Backfill für garantiert leere Antworten.',
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
    hinweis: 'Wie 107 am 25.07.2026 verifiziert: HTTP 500 auf Betriebsebene. Gilt für die ganze Gruppe '
           + '7 (Wareneinsätze), 8 (Personalkosten Jahr), 9 (Urlaubsverteilung), 23, 24 (Personalrechner), '
           + '107 und 118 (Wareneinsatz und Deckungsbeitrag). Erst nach Rechteklärung anfassen.',
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

  // --- Stammdaten: Momentaufnahmen ohne Zeitraum -------------------------
  //
  // Alle am 25.07.2026 live gegen die angemeldete Sitzung verifiziert:
  // Pfad, Antwortstruktur und Satzzahl stehen unten je Eintrag. Zusammen
  // kosten sie sieben Anfragen im Monat.
  {
    key: 'articleApi:franchise',
    ebene: 'stamm',
    pfad: '/wawi/rezept/articleApi',
    schrittweite: 'momentaufnahme',
    zweck: 'Sortimentshierarchie je Artikel: grosscat / mec / detailcat',
    aktiv: true,
    hinweis:
      'Verknüpfung zum Artikelverkaufsbericht ist artnr, NICHT id — am 25.07.2026 gemessen: '
    + 'artnr trifft die Artikelnummern des Verkaufsberichts, id trifft keine einzige '
    + '(id 19324 vs. artnr 300213, verschiedene Zahlenräume). '
    + 'Antwort ist ein Objekt, die Sätze liegen unter "articles" (9.132 Sätze, 3,2 MB). '
    + 'Ohne franchise=1 kommen nur die 1.428 Artikel des aktuellen Betriebs.',
    parameter: () => ({ franchise: '1', showAdditionalMecCodes: '0' }),
  },
  {
    key: 'analyticsFilterOptions',
    ebene: 'stamm',
    pfad: '/intranet/api/analyticsFilterOptions',
    schrittweite: 'momentaufnahme',
    zweck: 'Dimensionen: 334 Feinsparten, Hauptsparten, Verkaufsstellen, Gruppen, Betriebe',
    aktiv: true,
    hinweis:
      'Feinsparten sind {id, number, name} — analog zu hauptsparten {posId, number, name}. '
    + 'Bei Hauptsparten erwartet LINA als Filter posId und nicht number; nach derselben Logik '
    + 'wäre es bei Feinsparten id. UNGEPRÜFT — wir speichern die Dimension nur, filtern noch '
    + 'nicht danach. Wer das als Filter benutzt, prüft es vorher.',
    parameter: () => ({}),
  },
  {
    key: 'wawi:items',
    ebene: 'stamm',
    pfad: '/wawi/api/items',
    schrittweite: 'momentaufnahme',
    zweck: 'Waren mit Einkaufspreisen je Lieferant — rückwirkend NICHT nachholbar',
    aktiv: true,
    hinweis:
      '898 Sätze, 482 kB, Array auf oberster Ebene. prices ist ein OBJEKT, dessen Schlüssel '
    + 'die Preis-ID ist, kein Array. 299 der 898 Waren haben mehr als einen Lieferantenpreis. '
    + 'LINA kennt keine Preishistorie: was hier nicht monatlich gesichert wird, ist weg.',
    parameter: () => ({ archive: '0' }),
  },
  {
    key: 'wawi:suppliers',
    ebene: 'stamm',
    pfad: '/wawi/api/suppliers',
    schrittweite: 'momentaufnahme',
    zweck: 'Lieferantenstamm — nur Name, Mindestbestellwert und Liefertage',
    aktiv: true,
    hinweis:
      'DATENMINIMIERUNG: Die Antwort enthält 28 Felder, darunter ustid, hrb, kreditor, '
    + 'gegenkonto*, tel, email, strasse, plz. Davon wird NICHTS gespeichert — die '
    + 'Transformation hat eine explizite Whitelist. 540 Sätze.',
    parameter: () => ({}),
  },
  {
    key: 'wawi:units',
    ebene: 'stamm',
    pfad: '/wawi/api/units',
    schrittweite: 'momentaufnahme',
    zweck: 'Einheiten mit Umrechnungsfaktoren — ohne sie sind Mengen nicht vergleichbar',
    aktiv: true,
    hinweis: '32 Sätze: ID, name, abk, parent, factor, baseUnit.',
    parameter: () => ({}),
  },
  {
    key: 'wawi:orders',
    ebene: 'stamm',
    pfad: '/wawi/api/orders',
    schrittweite: 'momentaufnahme',
    zweck: 'Bestellungen mit Positionen',
    aktiv: true,
    hinweis:
      'Im Zentral-Kontext nur 4 Sätze. Zeitfelder (created, bestellt_am, liefertermin) sind '
    + 'Unix-Sekunden. posten ist ein verschachteltes Array.',
    parameter: () => ({}),
  },
  {
    key: 'wawi:inventory',
    ebene: 'stamm',
    pfad: '/wawi/inventory/inventory',
    schrittweite: 'momentaufnahme',
    zweck: 'Inventurstichtage',
    aktiv: true,
    hinweis: 'Hüllenformat {success, data, message, errorNum} — die 11 Sätze liegen unter data.',
    parameter: () => ({}),
  },
]

export const AKTIVE_ENDPUNKTE = ENDPUNKTE.filter(e => e.aktiv)

export function endpunkt(key: string): Endpunkt {
  const e = ENDPUNKTE.find(x => x.key === key)
  if (!e) throw new Error(`Unbekannter Endpunkt: ${key}`)
  return e
}
