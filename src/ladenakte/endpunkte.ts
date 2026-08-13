/**
 * Die Endpunkte der Ladenakte — und die Sperre, die verhindert, dass dieser
 * Importer etwas kaputt macht.
 *
 * Erhoben am 11.08.2026, vollstaendig in `docs/lina-api-inventar-ladenakte.md`
 * und `docs/ladenakte-messungen.md`.
 *
 * ES WIRD NICHT GEBLAETTERT. Die Belegliste kennt keine Seitengrenze: ein
 * Aufruf mit `length=100000` liefert einen ganzen Ordner (gemessen: 8.384
 * Eingangsrechnungen in 8,2 MB und 11,9 s). Damit faellt die gesamte
 * Fehlerklasse des Blaetterns weg — kein verschobenes Seitenraster, wenn
 * waehrend des Laufs jemand einen Beleg hochlaedt, keine Luecke, die hinterher
 * niemand bemerkt. Ein Ordner ist entweder ganz da oder gar nicht, und
 * `recordsTotal` sagt, welches von beidem.
 */
import type { Endpunkt } from '../lina/endpunkte'

/**
 * ERLAUBTE PFADE — eine Positivliste.
 *
 * ⚠ AUF DER VERTRAEGE-SEITE IST LOESCHEN EIN GEWOEHNLICHER GET-LINK:
 * `…/vertraege/laden/<hash>/vertragid/<id>/delete/1`. Kein Formular, kein POST,
 * keine Rueckfrage. Ein Crawler, der Links folgt, loescht damit Vertraege — bei
 * GSF Gastro 108 Stueck, darunter notarielle Urkunden. Deshalb folgt dieser
 * Importer nirgends einem Link; er ruft nur zusammengesetzte Pfade auf, und
 * `pfadPruefen()` laeuft vor jedem einzelnen.
 *
 * Der Grund fuer die Positivliste ist ein gescheiterter Versuch mit dem
 * Gegenteil.
 *
 * Zuerst stand hier eine Sperrliste verbotener Segmente. Sie liess sich nicht
 * dicht bekommen: `vertragEdit` ist ein Schreibpfad, aber als ganzes Segment
 * ungleich `edit`; `addgesell` legt einen Gesellschafter an, `addresse` waere
 * harmlos — und beide fangen mit `add` an. Jede Regel, die das eine faengt,
 * faengt entweder das andere mit oder laesst beide durch.
 *
 * Eine Positivliste hat dieses Problem nicht. Sie kennt fuenf Pfade, und alles
 * andere ist gesperrt — auch das, was LINA morgen dazubaut und niemand von uns
 * je gesehen hat. Der Preis ist, dass ein neuer Endpunkt hier eingetragen
 * werden muss. Das ist genau die Reibung, die man an dieser Stelle will.
 */
export const ERLAUBTE_PFADE: RegExp[] = [
  /^\/intranet\/ladenakte\/baum\/admin\/1$/,
  /^\/intranet\/ladenakte\/showBelegarchivFolder$/,
  /^\/intranet\/ladenakte\/beleglist$/,
  /^\/finanzen\/bwa\/longterm$/,
  /*
   * Stammdatenblatt. Zwei Formen, weil der Pfad einen Laden-Hash traegt, den es
   * erst zur Laufzeit gibt: im Register steht die nackte Basis, aufgerufen wird
   * die zusammengesetzte Form. Geprueft werden beide — die Basis, damit der
   * Registertest sie sieht, und die vollstaendige Form vor dem echten Aufruf.
   * Der Hash muss Hex sein: das schliesst ".." und alles andere Eingeschmuggelte
   * aus, ohne dass hier eine Pfadnormalisierung nachgebaut werden muss.
   */
  /^\/intranet\/ladenakte\/ladenstamm$/,
  /^\/intranet\/ladenakte\/ladenstamm\/laden\/[0-9a-f]{20,120}\/admin\/1\/?$/,
  /*
   * Die Belegdatei selbst. Bis zum 13.08.2026 stand hier nichts dergleichen,
   * und der Satz "keine einzige Belegdatei heruntergeladen" in
   * docs/lina-api-inventar-ladenakte.md war woertlich gemeint.
   *
   * Eingetragen fuer `src/korpus.ts` — den beaufsichtigten Einzelabzug eines
   * Beispielkorpus. Der naechtliche Lauf ruft diesen Pfad NICHT auf; er hat
   * keinen Endpunkt darauf und keinen Grund dazu. Wer das aendern will,
   * aendert damit die Datenmenge, die dieser Importer bewegt, um drei
   * Groessenordnungen — 593.677 Dateien statt 593.677 Zeilen.
   *
   * Lesend wie alles hier: ein GET, der eine Datei zurueckgibt. Der einzige
   * variable Teil ist `id=<encryptedId>`, und der steht im Query, den
   * `pfadPruefen()` bewusst nicht anfasst — er kann keinen anderen Endpunkt
   * ansprechen.
   */
  /^\/intranet\/ladenakte\/getBeleg$/,
]

/**
 * Zweiter Guertel. Ein Pfad, der die Positivliste passiert und trotzdem ein
 * Segment traegt, das GENAU eines dieser Woerter IST, ist ein Widerspruch —
 * dann stimmt etwas an der Positivliste nicht, und Scheitern ist die richtige
 * Antwort.
 *
 * ⚠ VERGLICHEN WIRD AUF GLEICHHEIT, NICHT AUF ENTHALTENSEIN. Das ist der Kern
 * dieser Liste, und er hat einen Preis gekostet.
 *
 * Bis zum 12.08.2026 stand hier `s.includes(v)`. Im ersten Lauf sind daran drei
 * Stammdatenblaetter gescheitert: der Laden-Hash im Pfad ist Hex, und `add`
 * besteht ausschliesslich aus Hexziffern. In einem 85-stelligen Hexstring
 * taucht die Folge `add` mit rund zwei Prozent Wahrscheinlichkeit auf — bei 131
 * Betrieben also in etwa drei Faellen. Genau drei sind eingetreten.
 *
 * Die Enthaltensein-Pruefung war ohnehin ein Ueberbleibsel aus der Zeit vor der
 * Positivliste (siehe den Kommentar dort). Sie kann hier nichts mehr fangen,
 * was die Positivliste durchlaesst: der einzige variable Teil eines erlaubten
 * Pfades ist der Hex-Hash, und der kann kein Schreibsegment SEIN. Sie kann nur
 * noch Unfaelle bauen — und hat es getan.
 */
export const VERBOTENE_SEGMENTE = [
  'delete', 'edit', 'upload', 'add', 'save', 'set', 'remove', 'loeschen',
  'create', 'new', 'apikeyadd', 'apikeydelete', 'setstoreheadquarter', 'addgesell',
]

export class VerbotenerPfad extends Error {
  constructor(pfad: string, grund: string) {
    super(`Ladenakte: Pfad "${pfad}" ist nicht freigegeben (${grund}). `
        + `Dieser Importer ruft ausschliesslich Pfade aus ERLAUBTE_PFADE auf, `
        + `und er folgt niemals Links (AGENTS.md Regel 1).`)
    this.name = 'VerbotenerPfad'
  }
}

/**
 * Wirft, wenn ein Pfad nicht ausdruecklich freigegeben ist.
 *
 * Vor JEDEM Aufruf gegen die Ladenakte. Der Query-Teil wird abgeschnitten und
 * nicht geprueft — er kann keinen anderen Endpunkt ansprechen.
 */
export function pfadPruefen(pfad: string): void {
  const ohneQuery = pfad.split('?')[0]
  if (!ERLAUBTE_PFADE.some(r => r.test(ohneQuery))) {
    throw new VerbotenerPfad(pfad, 'steht nicht in der Positivliste')
  }
  for (const segment of ohneQuery.split('/')) {
    const s = segment.toLowerCase()
    if (VERBOTENE_SEGMENTE.includes(s)) {
      throw new VerbotenerPfad(pfad, `Segment "${segment}" ist ein Schreibsegment`)
    }
  }
}

/**
 * Die 14 Belegarten des FiBu-Zweigs.
 *
 * DER LOHN-ZWEIG FEHLT HIER ABSICHTLICH und vollstaendig. Dort liegen
 * Ausweisdokumente (3980), Geburtsurkunden (4004), Krankmeldungen (13),
 * Pfaendungen (3986) und Aufenthaltserlaubnisse (3981). Entscheidung des
 * Nutzers vom 11.08.2026: nicht importieren. Eine Positivliste vergisst so
 * etwas nicht — eine Ausschlussliste haette bei der naechsten neuen Belegart
 * stillschweigend zugegriffen.
 */
export const FIBU_BELEGARTEN: { typId: string; name: string }[] = [
  { typId: '1', name: 'Eingangsrechnungen und Avise' },
  { typId: '2', name: 'Ausgangsrechnungen' },
  { typId: '3', name: 'Inventur und Bruchlisten' },
  { typId: '5', name: 'Kassenbelege' },
  { typId: '16', name: 'sonstige Dokumente' },
  { typId: '3968', name: 'sonstige Auswertungen' },
  { typId: '3969', name: 'USt-Voranmeldungen' },
  { typId: '3970', name: 'Lieferscheine' },
  { typId: '3971', name: 'Mahnungen' },
  { typId: '3972', name: 'Steuerunterlagen' },
  { typId: '3974', name: 'BWA' },
  { typId: '3975', name: 'Susa' },
  { typId: '3976', name: 'OPOS-Listen' },
  { typId: '3977', name: 'Kontoauszuege / Saldenbestaetigungen' },
]

/**
 * So gross, dass kein Ordner sie erreicht, und klein genug, dass ein Unfall
 * nicht das Rechenzentrum belastet. Groesster gemessener Ordner: Aposto Mainz
 * mit 12.639 Kassenbelegen. Bei 100.000 ist Luft fuer das Zehnfache.
 *
 * Wichtig ist nicht der Wert, sondern die Pruefung dahinter: der Lader
 * vergleicht die gelieferte Zeilenzahl mit `recordsTotal` und scheitert bei
 * Abweichung. Eine stillschweigend gekuerzte Antwort sieht sonst aus wie ein
 * kleiner Ordner.
 */
export const SEITENGROESSE = 100_000

/**
 * Die Zaehlung holt EINE Zeile — gebraucht wird nur `recordsTotal` daneben.
 *
 * Nicht 0: DataTables deutet `length=0` je nach Fassung als "keine Begrenzung"
 * und lieferte dann den ganzen Ordner, also genau das, was die Zaehlung
 * vermeiden soll. Eine Zeile ist die kleinste Menge, die sicher eine Menge ist.
 * Die gelieferte Zeile wird verworfen; geschrieben wird nur der Zaehlstand.
 */
export const ZAEHLGROESSE = 1

export const LADENAKTE_ENDPUNKTE: Endpunkt[] = [
  /**
   * DIE ZAEHLUNG — der Grund, warum das Belegarchiv ueberhaupt Zulauf bekommt.
   *
   * Bis zum 13.08.2026 entschied `manual.belegarchiv_soll` darueber, welcher
   * Ordner abgerufen wird: eine Handzaehlung vom 11.08.2026, die kein Code je
   * fortgeschrieben hat. Der Abzug lief am 12.08. um 13:25 fertig — seither
   * lieferte die Einreihbedingung null Zeilen, und `core.buchungsbeleg` bekam
   * KEINEN Beleg mehr. Die Laeufe 85 bis 88 hatten je null `la:*`-Aufgaben und
   * meldeten trotzdem "ok". Der Verlust lag bei rund 331 Belegen am Tag.
   *
   * WARUM EIN ZWEITER ENDPUNKT UND NICHT EINFACH TAEGLICH ALLES NEU HOLEN:
   * ein voller Ordnerabzug ist bis zu 8,2 MB und dauerte im Erstabzug im
   * Schnitt 3,0 s (Maximum 27,5 s) — 621 Ordner brauchten acht Stunden. Die
   * Zaehlung kostet eine Zeile und beantwortet dieselbe Frage: hat sich
   * `recordsTotal` gegenueber dem bewegt, was wir halten?
   *
   * WARUM NICHT NUR DAS DELTA HOLEN (start=<bekannt>&length=…): der Versatz
   * waere eine Zeilennummer, keine Beleg-ID. Wird in der Mitte eines Ordners
   * ein Beleg geloescht und ein neuer angehaengt, bleibt `recordsTotal`
   * gleich, das Fenster verschiebt sich, und der neue Beleg fehlt fuer immer —
   * lautlos. Gegenprobe am 13.08.2026: `lina_id` laeuft INNERHALB eines
   * Ordners nicht verlaesslich mit der Uploadzeit (Korrelation im Mittel
   * 0,991, aber acht Ordner unter 0,9, kleinster Wert 0,779). Die Annahme
   * traegt also nicht. Ein voller Abzug bei jeder Abweichung traegt.
   */
  {
    key: 'la:belegzahl',
    ebene: 'betrieb',
    pfad: '/intranet/ladenakte/beleglist',
    schrittweite: 'momentaufnahme',
    form: 'json',
    zweck: 'Zaehlstand eines Ordners — eine Zeile, dazu recordsTotal',
    aktiv: false,
    braucht: 'beleg_token',
    hinweis:
      'Derselbe Pfad wie la:belegliste, nur mit length=1. Schreibt NUR eine Zeile nach '
      + 'core.belegarchiv_bestand (quelle=zaehlung) und reiht la:belegliste nach, wenn der '
      + 'Zaehlstand von dem abweicht, was core.buchungsbeleg fuer dieses Paar haelt. '
      + 'Deshalb gilt hier die Vollstaendigkeitspruefung von la:belegliste NICHT: eine '
      + 'Antwort mit einer Zeile bei recordsTotal 8.384 ist genau das Gewollte.',
    parameter: (_von, _bis, extra = {}) => ({
      admin: '1', draw: '1', start: '0',
      length: String(ZAEHLGROESSE),
      'order[0][column]': '0',
      'order[0][dir]': 'asc',
      ...extra,
    }),
  },
  {
    key: 'la:belegliste',
    ebene: 'betrieb',
    pfad: '/intranet/ladenakte/beleglist',
    schrittweite: 'momentaufnahme',
    form: 'json',
    zweck: 'Belegmetadaten eines Ordners je Betrieb — ein Aufruf holt den ganzen Ordner',
    aktiv: false,
    braucht: 'beleg_token',
    hinweis:
      'DataTables-Huelle {data, recordsTotal, recordsFiltered}. Braucht einen storeId-Token; '
      + 'den holt LinaClient selbst, weil er je Anfrage neu gesalzen ist und deshalb nicht '
      + 'im Posten stehen darf. Sortiert aufsteigend nach Spalte 0 (LINA-Beleg-ID): neue '
      + 'Belege landen am Ende und verschieben nichts.',
    parameter: (_von, _bis, extra = {}) => ({
      admin: '1', draw: '1', start: '0',
      length: String(SEITENGROESSE),
      'order[0][column]': '0',
      'order[0][dir]': 'asc',
      ...extra,
    }),
  },
  {
    key: 'la:bwa_longterm',
    ebene: 'betrieb',
    pfad: '/finanzen/bwa/longterm',
    schrittweite: 'momentaufnahme',
    form: 'html',
    zweck: '77 BWA-Zeilen x bis zu 224 Monatsspalten je Betrieb, zurueck bis 06/2009',
    aktiv: false,
    braucht: 'bwa_hash',
    hinweis:
      'HTML, 0,1 bis 1,2 MB. Der laden=-Parameter ist je Anfrage neu gesalzen und kommt aus '
      + 'dem Baumknoten bwa_<id>; LinaClient holt ihn selbst. Der Franchisegeber liefert '
      + '80 Spalten und keinen einzigen Wert — das ist kein Fehler, sondern der Normalfall '
      + 'einer Holding, und der Lader schreibt dann nichts.',
    parameter: (_von, _bis, extra = {}) => ({ module: 'franchise', ...extra }),
  },
  {
    key: 'la:stammdaten',
    ebene: 'betrieb',
    pfad: '/intranet/ladenakte/ladenstamm',
    schrittweite: 'momentaufnahme',
    form: 'html',
    zweck: 'Kapazitaet je Bereich, Plan-BWA und Tagesbudget mit Plan-Stunden',
    aktiv: false,
    braucht: 'stamm_pfad',
    hinweis:
      'HTML, rund 310 KB, sieben Tabellen. Der Pfad traegt einen Laden-Hash und wird '
      + 'deshalb zur Laufzeit zusammengesetzt. ACHTUNG: eine der sieben Tabellen fuehrt die '
      + 'LINA-API-Schluessel im Klartext — der Parser liest ueber eine Positivliste genau '
      + 'drei Kopfzeilen, und das Roh-HTML wird vor der Ablage bereinigt.',
    parameter: (_von, _bis, extra = {}) => ({ ...extra }),
  },
]

/** Alle Ladenakte-Schluessel, zur Weiche in src/sync/laden.ts. */
export const LADENAKTE_KEYS = new Set(LADENAKTE_ENDPUNKTE.map(e => e.key))

export const istLadenakte = (key: string) => key.startsWith('la:')

// ---------------------------------------------------------------------------
// Baumknoten — kein Posten, sondern Beiwerk des Tokenholens
// ---------------------------------------------------------------------------

/**
 * Der Baum-Endpunkt. Steht bewusst NICHT in `LADENAKTE_ENDPUNKTE`: er wird nie
 * eingereiht, sondern nur von `LinaClient` beim Tokenholen benutzt — so wie die
 * Loginseite beim Anmelden.
 *
 * Er liefert JSON und deklariert es als `text/html`. Genau deshalb steht die
 * Form im Register und wird nicht am Content-Type abgelesen.
 */
export const BAUM: Endpunkt = {
  key: 'la:baum',
  ebene: 'betrieb',
  pfad: '/intranet/ladenakte/baum/admin/1',
  schrittweite: 'momentaufnahme',
  form: 'json',
  zweck: 'Baumknoten der Ladenakte — liefert die gesalzenen Links eines Betriebs',
  aktiv: false,
  parameter: (_von, _bis, extra = {}) => ({ ...extra }),
}

/** Die Ordnerseite. Traegt den storeId-Token fuer die Belegliste im HTML. */
export const ORDNERSEITE: Endpunkt = {
  key: 'la:ordnerseite',
  ebene: 'betrieb',
  pfad: '/intranet/ladenakte/showBelegarchivFolder',
  schrittweite: 'momentaufnahme',
  form: 'html',
  zweck: 'Ordnerseite des Belegarchivs — nur zum Holen des storeId-Tokens',
  aktiv: false,
  parameter: (_von, _bis, extra = {}) => ({ admin: '1', ...extra }),
}
