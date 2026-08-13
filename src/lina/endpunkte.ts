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
import { LADENAKTE_ENDPUNKTE } from '../ladenakte/endpunkte'
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

/**
 * In welcher Reihenfolge ein Endpunkt eingereiht wird — und warum das keine
 * Geschmacksfrage ist.
 *
 * Es gibt eine echte Kette, und jedes ihrer Glieder reisst LEISE:
 *
 *   1. Die Tagesberichte legen die Betriebe an. Ihr Schluessel ist LINAs
 *      `encId`, und die kommt nur dort vor.
 *   2. `analyticsFilterOptions` heftet den Betrieben ihre NUMERISCHE LINA-ID
 *      an — verbunden ueber den Namen, weil `encId` in dieser Antwort fehlt.
 *      Auf einer leeren Datenbank gibt es dafuer noch nichts zu tun.
 *   3. `getKennzahlen` kennt Betriebe ausschliesslich ueber diese numerische
 *      ID. Fehlt sie, findet keine einzige BWA-Zeile ihren Betrieb.
 *
 * Reisst Glied 2 oder 3, meldet der Posten trotzdem `ok` und
 * `core.kennzahlen_monat` bleibt leer. Am 26.07.2026 sind so 7.860 BWA-Zeilen
 * durchgefallen — die BWA traegt den Round Table, ein leiserer Totalausfall
 * ist schwer vorstellbar.
 *
 * Daneben eine zweite, gleich stille Abhaengigkeit: `articleApi:franchise`
 * ordnet Warengruppen nur Artikeln zu, die `core.artikel` schon kennt, und
 * gefuellt wird der Katalog vom Artikelverkaufsbericht. Laeuft die
 * Momentaufnahme davor, ordnet sie in diesem Monat nichts zu — und
 * rueckwirkend gibt es keine zweite Chance, weil LINA keine
 * Warengruppenhistorie fuehrt.
 *
 * Bis zum 26.07.2026 hing das alles an der Einfuegereihenfolge: gleiche
 * Prioritaet, dann entscheidet die `posten_id`. Beim ersten Lauf gegen die
 * frisch aufgesetzte Datenbank lag `getKennzahlen` prompt vor
 * `analyticsFilterOptions`. Eine Abhaengigkeit gehoert nicht in eine
 * Zufaelligkeit.
 */
export const PRIORITAET = {
  /** Tagesberichte. Legen Betriebe und Artikel an. */
  laufend: 10,
  /** analyticsFilterOptions: braucht die Betriebe, liefert deren LINA-ID. */
  bruecke: 12,
  /** getKennzahlen: braucht die LINA-ID. */
  bwa: 14,
  /** Uebrige Momentaufnahmen. Brauchen den Artikelkatalog. */
  nachlauf: 20,
  /** Nacharbeit nach einem Fehler. */
  nacharbeit: 50,
  /** Historie, rueckwaerts. */
  historie: 90,
} as const

export function einreihPrioritaet(key: string): number {
  if (key === 'analyticsFilterOptions') return PRIORITAET.bruecke
  if (key.startsWith('getKennzahlen')) return PRIORITAET.bwa
  if (istMomentaufnahme(endpunkt(key))) return PRIORITAET.nachlauf
  return PRIORITAET.laufend
}

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
  /**
   * In welchem Takt eine Momentaufnahme wiederholt wird. Vorgabe `monat`.
   *
   * Momentaufnahmen haben keinen Zeitraum, den man nachholen könnte — es gibt
   * nur „jetzt". Wie oft „jetzt" neu erhoben wird, ist deshalb eine
   * Abwägung je Endpunkt und keine Eigenschaft der Gattung: bei den meisten
   * ändert sich zwischen zwei Monaten nichts, bei
   * `analyticsFilterOptions` hängt an der Aktualität, ob ein neuer Betrieb
   * überhaupt Daten bekommt.
   *
   * Der Takt hängt am ZEITRAUM des Postens (Wochenanfang bzw. Monatserster)
   * und nicht an einem Ergebniswert — dieselbe Lehre wie überall sonst hier:
   * ein Wiederholtakt, der an einem Ausgang hängt, kennt immer einen, an den
   * niemand gedacht hat.
   */
  takt?: 'monat' | 'woche'
  /**
   * Wie viele Tage rückwärts dieser Tagesbericht nachgeholt wird. Ohne
   * Angabe gilt `config.NACHZUEGLER_TAGE`.
   *
   * WARUM JE ENDPUNKT UND NICHT GLOBAL. Am 13.08.2026 an
   * `raw.api_antwort.payload_hash` gemessen — wie oft sich derselbe
   * Geschäftstag zwischen zwei Abrufen noch geändert hat, nach Abstand:
   *
   *   Abstand              1   2   3   4   5   6   7   8   9  10  11
   *   getArtikelverkauf   22  28  31  31  31  31  30  31  30  30   9
   *   getPersonalkosten   13  23  25  22  21  20  22  24  21  22   9
   *   getUmsatzbericht     -   5   1   1   1   -   -   1   1   1   -
   *
   * Drei Endpunkte, drei völlig verschiedene Kurven — ein gemeinsames
   * Fenster kann für höchstens einen davon richtig sein.
   *
   * UND DIE ZAHLEN OBEN SIND ABGESCHNITTEN: bei Artikel und Personal ist
   * die Rate bis Tag 10 flach, der Einbruch bei Tag 11 ist die Grenze von
   * `NACHZUEGLER_TAGE` und kein Abklingen. Wo das Fenster hier steht, ist
   * deshalb eine Schätzung mit Reserve und keine Messung — die Messung
   * liefert ab jetzt `mart.nachzuegler_tiefe`, und die Prüfübersicht
   * meldet, wenn am Rand noch etwas ankommt.
   */
  nachzuegler_tage?: number
  hinweis?: string
  /**
   * Welche Form die Antwort hat. Vorgabe `json` — so verhalten sich alle
   * Endpunkte, die es vor dem 11.08.2026 gab.
   *
   * WARUM DAS INS REGISTER GEHÖRT UND NICHT AN DEN CONTENT-TYPE. LINA setzt
   * den Header nicht verlässlich: `/intranet/ladenakte/baum/...` liefert
   * sauberes JSON und deklariert es als `text/html`. Wer am Header entscheidet,
   * parst dort das Falsche. Die Form ist eine Eigenschaft des Endpunkts, und
   * bekannt ist sie aus der Messung — also steht sie hier.
   *
   * `html` heißt nur: der Rohtext wird unverändert durchgereicht statt durch
   * `JSON.parse` geschickt. Es heißt NICHT, dass ein Dokument-Header gesendet
   * wird — die HTML-liefernden Ladenakte-Endpunkte werden von LINAs eigener
   * Oberfläche ebenfalls per XHR nachgeladen (am 11.08.2026 im Browser so
   * gemessen). Ein Navigations-Header wäre hier die unstimmige Variante.
   */
  form?: 'json' | 'html'
  /**
   * Was vor dem Aufruf aufgelöst werden muss.
   *
   * Die Ladenakte vergibt je Anfrage neue, gesalzene Zugriffsmerkmale. Sie
   * können nicht im Warteschlangenposten stehen — nach dem ersten Lauf wären
   * alle Posten wertlos. `LinaClient` löst sie kurz vor dem Aufruf auf, über
   * denselben gedrosselten Weg, so wie er bei abgelaufener Sitzung neu anmeldet.
   *
   * Der Betrieb kommt dafür als `linaBetriebId` in den Zusatzparametern.
   */
  braucht?: 'beleg_token' | 'bwa_hash' | 'stamm_pfad'
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
    /**
     * 21 statt 10 Tage. Die Änderungsrate ist bis Tag 10 flach (rund 22 je
     * Tag) — sie klingt nicht ab, wir hören nur auf hinzusehen. Drei Wochen
     * sind deshalb eine Schätzung mit Reserve, kein Messergebnis; die
     * Messung liefert `mart.nachzuegler_tiefe`.
     *
     * `core.personalkosten` ist ein Upsert ohne Historie: was hier nicht
     * nachgeholt wird, ist unwiederbringlich falsch und sieht dabei richtig
     * aus. Von allen Tagesberichten ist das der, bei dem ein zu kurzes
     * Fenster am wenigsten auffällt.
     */
    nachzuegler_tage: 21,
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
    /**
     * 21 statt 10 Tage — und ausdrücklich GEGEN die Annahme des Plans, der
     * Artikelbericht komme mit fünf Tagen aus. Gemessen ändert er sich an
     * JEDEM der ersten zehn Tage rund dreißigmal, ohne abzuklingen; er ist
     * damit der unruhigste der drei geprüften Tagesberichte.
     *
     * Der Preis ist Zeilenvolumen, nicht Aufrufzahl: elf zusätzliche
     * Abrufe am Tag, aber die größte Antwort im Register. Sie schreiben in
     * `core.artikelverkauf_tag`, das partitioniert ist und den Upsert je
     * Tag ersetzt — es wächst dadurch nicht.
     */
    nachzuegler_tage: 21,
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
    /**
     * WÖCHENTLICH statt monatlich (13.08.2026, Punkt 2.9 des Plans).
     *
     * Diese Antwort ist die EINZIGE Quelle für `core.betrieb.lina_betrieb_id`
     * — die numerische ID, die über einen Namens-Join angeheftet wird. Und an
     * dieser ID hängt alles Betriebsbezogene: die BWA über `getKennzahlen`,
     * und seit Migration 0069 die tägliche Zählung des Belegarchivs.
     *
     * Ein neu eröffneter Betrieb wartete damit bis zu VIER WOCHEN auf seine
     * erste Zählung. Das ist derselbe Fall, den 0069 für die Ordner gelöst
     * hat — „neuer Betrieb fällt stumm heraus" —, nur eine Ebene höher.
     *
     * Kosten: drei zusätzliche Aufrufe im Monat, gegen ein LINA-Tagesbudget
     * von 10.500 bei rund 82 verbrauchten. Die Frage war nie der Preis,
     * sondern dass niemand hingesehen hat.
     */
    takt: 'woche',
    zweck: 'Dimensionen: 334 Feinsparten, Hauptsparten, Verkaufsstellen, Gruppen, Betriebe',
    aktiv: true,
    hinweis:
      'Feinsparten sind {id, number, name} — analog zu hauptsparten {posId, number, name}. '
    + 'Bei Hauptsparten erwartet LINA als Filter posId und nicht number; nach derselben Logik '
    + 'wäre es bei Feinsparten id. UNGEPRÜFT — wir speichern die Dimension nur, filtern noch '
    + 'nicht danach. Wer das als Filter benutzt, prüft es vorher.',
    parameter: () => ({}),
  },
  // -------------------------------------------------------------------
  // LINAs Warenwirtschaft — ABGESTELLT am 01.08.2026 (Migration 0030)
  //
  // Die Werte dort sind Demodaten (Vorgabe Eugene, 27.07.2026; AGENTS.md
  // Regel 5). Waren, Lieferanten, Bestellungen und Einheiten kommen seit
  // Migration 0030 aus FoodNotify.
  //
  // Die Zahlen, die es hätten verraten können: 540 Lieferanten und 898
  // Waren — aber nur 4 Bestellungen mit 18 Positionen und 11
  // Inventurtermine. Das ist kein spärlich genutztes Modul, das ist ein
  // leeres.
  //
  // aktiv: false statt gelöscht, damit der Befund und die Antwortstruktur
  // dokumentiert bleiben — beides war Arbeit, und wer später fragt "haben
  // wir das mal geprüft?", findet hier die Antwort. Die zugehörigen
  // Tabellen (core.ware, lieferant, bestellung, bestellposten,
  // einkaufspreis_stand, einheit, ware_stand) sind in 0030 gelöscht; der
  // Ladecode in sync/laden.ts ist mit entfernt. Wer einen dieser
  // Endpunkte wieder einschaltet, muss beides neu bauen.
  // -------------------------------------------------------------------
  {
    key: 'wawi:items',
    ebene: 'stamm',
    pfad: '/wawi/api/items',
    schrittweite: 'momentaufnahme',
    zweck: 'Waren mit Einkaufspreisen je Lieferant — DEMODATEN, abgestellt',
    aktiv: false,
    hinweis:
      '898 Sätze, 482 kB, Array auf oberster Ebene. prices ist ein OBJEKT, dessen Schlüssel '
    + 'die Preis-ID ist, kein Array. 299 der 898 Waren haben mehr als einen Lieferantenpreis. '
    + 'ABGESTELLT 01.08.2026: Demodaten. Echte Einkaufspreise kommen aus FoodNotifys '
    + 'Bestellungen (core.bestellposition) — und zwar als Belegpreise, nicht als Katalogpreise.',
    parameter: () => ({ archive: '0' }),
  },
  {
    key: 'wawi:suppliers',
    ebene: 'stamm',
    pfad: '/wawi/api/suppliers',
    schrittweite: 'momentaufnahme',
    zweck: 'Lieferantenstamm — DEMODATEN, abgestellt',
    aktiv: false,
    hinweis:
      'DATENMINIMIERUNG: Die Antwort enthält 28 Felder, darunter ustid, hrb, kreditor, '
    + 'gegenkonto*, tel, email, strasse, plz. Davon wurde NICHTS gespeichert — die '
    + 'Transformation hatte eine explizite Whitelist. 540 Sätze. '
    + 'ABGESTELLT 01.08.2026: Demodaten.',
    parameter: () => ({}),
  },
  {
    key: 'wawi:units',
    ebene: 'stamm',
    pfad: '/wawi/api/units',
    schrittweite: 'momentaufnahme',
    zweck: 'Einheiten mit Umrechnungsfaktoren — abgestellt',
    aktiv: false,
    hinweis: '32 Sätze: ID, name, abk, parent, factor, baseUnit. '
    + 'ABGESTELLT 01.08.2026: FoodNotify liefert eigene Einheiten je Ware. Ein gemeinsamer '
    + 'Einheitenschlüssel über zwei Systeme wäre eine Übersetzung, die niemand pflegt.',
    parameter: () => ({}),
  },
  {
    key: 'wawi:orders',
    ebene: 'stamm',
    pfad: '/wawi/api/orders',
    schrittweite: 'momentaufnahme',
    zweck: 'Bestellungen mit Positionen — DEMODATEN, abgestellt',
    aktiv: false,
    hinweis:
      'Im Zentral-Kontext nur 4 Sätze. Zeitfelder (created, bestellt_am, liefertermin) sind '
    + 'Unix-Sekunden. posten ist ein verschachteltes Array. '
    + 'ABGESTELLT 01.08.2026: vier Bestellungen waren der Hinweis, den wir zu lange als '
    + '"hängt am Zentral-Kontext" gedeutet haben. Aposto allein hat in FoodNotify 11.578.',
    parameter: () => ({}),
  },
  {
    key: 'wawi:inventory',
    ebene: 'stamm',
    pfad: '/wawi/inventory/inventory',
    schrittweite: 'momentaufnahme',
    zweck: 'Inventurstichtage — DEMODATEN, abgestellt',
    aktiv: false,
    hinweis: 'Hüllenformat {success, data, message, errorNum} — die 11 Sätze liegen unter data. '
    + 'ABGESTELLT 01.08.2026: Demodaten. Echte Inventuren stehen in FoodNotify (Wilma Wunder 275).',
    parameter: () => ({}),
  },
]

export const AKTIVE_ENDPUNKTE = ENDPUNKTE.filter(e => e.aktiv)

/**
 * Die Ladenakte-Endpunkte stehen in `src/ladenakte/endpunkte.ts`, werden hier
 * aber mitgesucht — sonst findet der Worker seine Posten nicht.
 *
 * Sie stehen NICHT in `ENDPUNKTE`: dort speist jeder Eintrag mit `aktiv: true`
 * das automatische Nachfuellen, und auf Betriebsebene waeren das 131 Posten je
 * Zeitraum. Eingereiht wird ausschliesslich von `ladenakteNachfuellen()`,
 * gezielt und nur fuer das, was fehlt.
 */
export function endpunkt(key: string): Endpunkt {
  const e = ENDPUNKTE.find(x => x.key === key)
    ?? LADENAKTE_ENDPUNKTE.find(x => x.key === key)
  if (!e) throw new Error(`Unbekannter Endpunkt: ${key}`)
  return e
}
