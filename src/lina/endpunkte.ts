/**
 * Berichtsregister.
 *
 * Eine Stelle, an der steht, welche LINA-Berichte wir holen, wie ihre
 * Parameter aussehen und in welcher Schrittweite sie eingereiht werden.
 * Neue Berichte sind ein Eintrag, kein Codeumbau.
 *
 * Die beiden Ebenen aus Phase 1 unterscheiden sich in mehr als der URL:
 *   Konzern  /intranet/analytics/...       alle 141 Betriebe je Antwort,
 *                                          Datum als 01.06.2026
 *   Betrieb  /intranet/storeanalytics/...  ein Betrieb je Antwort (laden=<encId>),
 *                                          Datum als 1.6.2026  (ohne führende Null)
 *
 * ~~Betrieb  /finanzen/analytics/...  (storeId)~~ — dieser Weg antwortet mit 200
 * und leeren Gerüsten, für jeden Betrieb und Zeitraum (KORREKTUR 7, 22.09.2026).
 * Die Betriebsberichte stehen seitdem in einem eigenen Register:
 * `src/lina/betriebsberichte.ts`. Hier stehen nur Konzern- und Stammdaten.
 */
import { LADENAKTE_ENDPUNKTE } from '../ladenakte/endpunkte'
import { BETRIEBSBERICHTE } from './betriebsberichte'
import { zuLinaDatum } from '../lib/time'

export type Ebene = 'konzern' | 'betrieb' | 'stamm'
/** `woche` gibt es nur bei Betriebsberichten der Fensterklasse W (sieben Tage). */
export type Schrittweite = 'tag' | 'woche' | 'monat' | 'jahr' | 'momentaufnahme'

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
  /**
   * Betriebsberichte (0113), laufend wie Historie — ihre Reihenfolge ist das
   * Datum, nicht die Stufe. Sie konkurrieren NICHT ueber die Prioritaet mit
   * den uebrigen LINA-Posten: die LINA-Spur zieht beide Haelften abwechselnd
   * (sync.posten_holen 'lina_br' / 'lina_sonst'), und Betriebsberichte nur,
   * solange das Budget fuer die faelligen uebrigen Posten reicht.
   */
  betriebsbericht: 85,
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
  /**
   * Monatliche Nachlese: einmal im Monat werden die Tage zwischen dem Ende
   * des Fensters und so vielen Tagen zurueck neu eingereiht
   * (`nachleseNachziehen()`). Fuer Berichte, die sich nachweislich noch
   * aendern, wenn das Fenster laengst zu ist — gemessen an
   * `mart.nachzuegler_tiefe` mit konfiguriertem Rand (seit 0100).
   */
  nachlese_tage?: number
  /**
   * Kanonische Form der Antwort fuer den Hash in `raw.api_antwort`
   * (`payload_hash`): was hier zurueckkommt, wird mit sortierten Schluesseln
   * serialisiert und gehasht. Fuer Endpunkte, deren Arrays keine Reihenfolge
   * tragen — getArtikelverkaufsbericht liefert `columns` bei jedem Abruf
   * anders sortiert (10.09.2026: 2.466 von 3.414 Positionen vertauscht,
   * Inhalt gleich). Ohne diese Ordnung zaehlte `mart.nachzuegler_tiefe` jeden
   * Abruf als Aenderung. Darf die Daten NICHT veraendern, nur ordnen; der
   * Lader bekommt weiterhin das Original.
   */
  kanonisch?: (daten: unknown) => unknown
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
  /**
   * Die Antwort ist ein JSON-String, der JSON enthält. So liefern LINAs
   * Betriebsberichte (22.09.2026): `JSON.parse` ergibt einen String, erst das
   * zweite Parsen das Objekt. Der Client packt beides aus, damit raw, Hash,
   * Schema und Lader dasselbe Objekt sehen.
   */
  doppeltKodiert?: boolean
  /**
   * Unter welchem Parameternamen der Betrieb aus `sync.warteschlange.betrieb_enc_id`
   * in die Anfrage geht. Nur Betriebsberichte haben einen (`laden`). Ein Posten
   * mit Betrieb für einen Endpunkt ohne diese Angabe ist ein Baufehler und wirft.
   */
  betriebParameter?: 'laden'
}

/** Konzern-Ebene: DD.MM.YYYY mit führender Null. */
const konzernZeitraum = (von: string, bis: string) => ({
  von: zuLinaDatum(von),
  bis: zuLinaDatum(bis),
  reltime: 'custom',
  brutto: '0',
  preExistingRevenue: '0',
})

/**
 * getArtikelverkaufsbericht: `columns` (der Artikelkatalog) nach `artnr`
 * ordnen. Die Zeilen (`rows`) sind Objekte je Betrieb mit Artikelnummern als
 * Schluesseln — die sortiert der kanonische Serialisierer ohnehin.
 */
function artikelverkaufKanonisch(daten: unknown): unknown {
  if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) return daten
  const d = daten as Record<string, unknown>
  if (!Array.isArray(d.columns)) return daten
  const rang = (c: unknown) => {
    const n = (c as Record<string, unknown> | null)?.artnr
    return typeof n === 'number' ? n : Number(n ?? Number.MAX_SAFE_INTEGER)
  }
  const columns = [...d.columns].sort((a, b) => rang(a) - rang(b)
    || JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return { ...d, columns }
}

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
  /*
   * DIE ACHT ÜBRIGEN HAUPTSPARTEN (Plan 5.1, Entscheidung 4, 14.08.2026).
   *
   * Die Frage des Plans lautete: „ist der Spartenfilter ein Parameter, den wir
   * einfach mit weiteren posId aufrufen können — dann ist die Reparatur klein."
   * Die Antwort stand seit dem 26.07.2026 im Register selbst: die beiden
   * Einträge darüber unterscheiden sich von `getUmsatzbericht` durch genau
   * einen Query-Parameter, und `src/sync/laden.ts` schlägt daraus schon heute
   * generisch die `hauptsparte_key` nach. Es fehlten acht Zeilen.
   *
   * WAS DAS EINBRINGT. Gemessen an den letzten 30 Tagen (14.08.2026):
   * 9.002.801,71 € Gesamtumsatz, davon Speisen 3.504.469,69 und Getränke
   * 2.634.893,62 — **2.863.438,40 € oder 31,8 % standen nur in der
   * Gesamtzeile** und waren nicht aufteilbar. Ob es danach null ist, sagt
   * `mart.hauptsparte_abdeckung`; ein Rest kann echt sein, denn ob LINA jede
   * der zehn Sparten bebucht, ist eine Frage an den Fachbereich.
   *
   * WAS ES KOSTET. Acht Endpunkte × 10 Nachzügler-Tage = 80 Aufrufe am Tag.
   * Das LINA-Tagesbudget ist 10.500, verbraucht wurden bis hierher rund 104.
   *
   * `hauptsparten` ERWARTET DIE posId, NICHT DIE nummer — mit der nummer
   * kommt kommentarlos 0 €. Das steht seit dem 26.07.2026 am Eintrag für
   * Speisen und gilt hier genauso; die posId ist die Zahl aus
   * `core.hauptsparte.pos_id`.
   */
  {
    key: 'getUmsatzbericht:gutscheine',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Gutscheine (posId 10003)',
    aktiv: true,
    hinweis: 'LINA fuehrt ZWEI Gutschein-Sparten: 10003 "Gutscheine" (nummer 3) und '
           + '95 "Gutschein" (nummer 57). Welche bebucht wird, ist offen — deshalb beide.',
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '10003',
    }),
  },
  {
    key: 'getUmsatzbericht:sonstiges',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Sonstiges / Divers (posId 10004)',
    aktiv: true,
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '10004',
    }),
  },
  {
    key: 'getUmsatzbericht:sv_getraenke',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Straßenverkauf Getränke (posId 10006)',
    aktiv: true,
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '10006',
    }),
  },
  {
    key: 'getUmsatzbericht:sv_speisen',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Straßenverkauf Speisen (posId 10007)',
    aktiv: true,
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '10007',
    }),
  },
  {
    key: 'getUmsatzbericht:lieferkosten',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Lieferkosten (posId 10008)',
    aktiv: true,
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '10008',
    }),
  },
  {
    key: 'getUmsatzbericht:pfand',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Pfand (posId 92)',
    aktiv: true,
    hinweis: 'Zweistellige posId — die drei Sparten 92, 94 und 95 stammen aus einem '
           + 'aelteren Nummernkreis als die 100xx. Beides sind posId, nicht nummer.',
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '92',
    }),
  },
  {
    key: 'getUmsatzbericht:trinkgeld',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Trinkgeld (posId 94)',
    aktiv: true,
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '94',
    }),
  },
  {
    key: 'getUmsatzbericht:gutschein_95',
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: 'Umsatz nur Hauptsparte Gutschein (posId 95)',
    aktiv: true,
    hinweis: 'Die zweite Gutschein-Sparte, siehe getUmsatzbericht:gutscheine. Beide '
           + 'zu holen ist billiger, als zu raten, welche gemeint ist.',
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), hauptsparten: '95',
    }),
  },
  /*
   * DIE SIEBEN VERKAUFSSTELLEN (Plan „Vollabzug", Meilenstein M0, 22.09.2026).
   *
   * `core.umsatzbericht_tag.verkaufsstelle_key` steht seit `0003` im Schema,
   * wird von einem Dutzend `mart`-Sichten mitgefuehrt und war bis hierher
   * NIE gefuellt — `laden.ts` schrieb fest `null`, und kein Registereintrag
   * sendete `verkaufsstellen`. `kennzahlen-mapping.md` fuehrte „Umsatz pro
   * Verkaufsstelle" trotzdem als erledigt. Dieselbe Signatur wie Regel 10:
   * eine Spalte, die aussieht, als waere sie versorgt.
   *
   * Bauart wie die Hauptsparten aus `0077`: ein Konzernaufruf je Tag und
   * Stelle deckt alle 141 Betriebe; `laden.ts` schlaegt aus dem Parameter
   * die `verkaufsstelle_key` nach (`core.verkaufsstelle.nummer`).
   *
   * UNGEPRUEFT, UND DESHALB MIT WAECHTER: `verkaufsstellen` erwartet laut
   * `lina-api-inventar.md` §3.1 die `number` aus `analyticsFilterOptions` —
   * „aus den Vue-Bundles extrahiert", nie gegen eine Antwort gemessen. Bei den
   * Hauptsparten war die naheliegende Lesart falsch (posId statt number), und
   * die falsche lieferte kommentarlos 0 EUR. Ob es hier genauso ist, zeigt
   * `mart.verkaufsstelle_abdeckung` nach der ersten Nacht: die Summe der
   * sieben Stellen muss den Gesamtumsatz treffen. 0 % heisst falsches Format,
   * rund 700 % heisst, LINA ignoriert den Filter. Beides steht als Zeile in
   * `mart.pruefung_uebersicht` (Migration `0112`).
   *
   * Kosten: 7 × 10 Nachzuegler-Tage = 70 Aufrufe je Nacht, die Historie
   * (7 × ~3.100 Tage) laeuft ueber `HISTORIE_JE_LAUF` mit.
   */
  ...([
    [0, 'gesamtbetrieb', 'Gesamtbetrieb'],
    [1, 'ausser_haus', 'Ausser Haus'],
    [2, 'amadeusgo', 'AmadeusGO'],
    [51, 'cocktail_casino', 'Cocktail Casino'],
    [52, 'delivery', 'Delivery'],
    [53, 'to_go_lehners', 'To Go Lehners'],
    [56, 'to_go_aktionspreis', 'To Go Aktionspreis'],
  ] as const).map(([nummer, schluessel, name]): Endpunkt => ({
    key: `getUmsatzbericht:vs_${schluessel}`,
    ebene: 'konzern',
    pfad: '/intranet/analytics/getUmsatzbericht',
    schrittweite: 'tag',
    zweck: `Umsatz nur Verkaufsstelle ${name} (Nummer ${nummer})`,
    aktiv: true,
    hinweis: 'verkaufsstellen erwartet laut Vue-Bundle die number — UNGEPRUEFT. '
           + 'Gegenprobe: mart.verkaufsstelle_abdeckung.',
    parameter: (von, bis) => ({
      report: 'intranet-umsatz', ...konzernZeitraum(von, bis), verkaufsstellen: String(nummer),
    }),
  })),
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
    /**
     * Und einmal im Monat zwei Monate zurueck (10.09.2026): am letzten Tag
     * des Fensters aenderten sich noch 24 von 30 Abrufen, mit echten Werten
     * (pekGesamt, effGesamt) — Lohn schliesst monatlich ab, nicht binnen
     * drei Wochen. 41 Aufrufe im Monat statt 14 zusaetzlicher je Nacht.
     */
    nachlese_tage: 62,
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
    kanonisch: artikelverkaufKanonisch,
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

  // --- Betriebs-Ebene ------------------------------------------------------
  //
  // HIER STANDEN BIS ZUM 22.09.2026 VIER `getReport:*` (38, 107, 23, 97) mit
  // dem Pfad /finanzen/analytics/getReport und storeId= — dem Weg, der für
  // jeden Betrieb leere Gerüste liefert (KORREKTUR 7). Sie stehen jetzt mit
  // korrigiertem Pfad in src/lina/betriebsberichte.ts, zusammen mit allen
  // übrigen Betriebsberichten. Ihre Befunde (107/23 gesperrt, 38 nur mit
  // nBillsGesamt = 0 gemessen) stehen dort als `hinweis`.

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
    ?? BETRIEBSBERICHTE.find(x => x.key === key)
  if (!e) throw new Error(`Unbekannter Endpunkt: ${key}`)
  return e
}
