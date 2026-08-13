/**
 * Konfiguration aus Umgebungsvariablen. Wird beim Start einmal geprüft —
 * ein fehlendes Passwort soll beim Hochfahren auffallen, nicht nach zwei
 * Stunden Backfill.
 */
import { z } from 'zod'

const Schema = z.object({
  DATABASE_URL: z.string().min(1),

  LINA_BASE_URL: z.string().default('https://app.lina.de'),
  LINA_USER: z.string().min(1),
  LINA_PASSWORD: z.string().min(1),
  /** Mandant aus dem Login-Dropdown. a360 = LINA TeamCloud. */
  LINA_SYSTEM: z.enum(['a360', 'dispatch', 'driver', 'storedashboard']).default('a360'),
  /**
   * Hashverfahren für das Passwort.
   *
   * 'md5' ist der beobachtete Stand: /js/common/login.js sendet
   * hex_md5(password). Im LINA-Code steht eine auskommentierte Zeile, die
   * SHA-256 vorbereitet — stellt LINA um, reicht hier 'sha256'.
   * 'plain' nur zum Debuggen.
   */
  LINA_PASSWORD_HASH: z.enum(['md5', 'sha256', 'plain']).default('md5'),

  /**
   * Browserkennung. Bewusst der unauffälligste Fall, den es gibt: aktuelles
   * Chrome Stable auf Windows 10/11 — die mit Abstand häufigste Kombination
   * in einem deutschen Firmennetz und damit die, die in keinem Log auffällt.
   *
   * 149 war am 25.07.2026 die Windows-Stable-Version (bei Chromium Dash
   * geprüft). Chrome kürzt seinen User-Agent selbst: die Nebenversionen sind
   * immer 0, und "Windows NT 10.0" meldet auch Windows 11.
   *
   * Wird das hier geändert, ziehen die Client-Hints in src/lina/auth.ts die
   * Versionsnummer automatisch nach — sonst widersprächen sich Kennung und
   * Hints, und genau das fällt auf.
   *
   * Nicht auf eine ältere Version zurückstellen: Chrome aktualisiert sich
   * still, eine ein Jahr alte Version ist auffälliger als gar keine Angabe.
   */
  LINA_USER_AGENT: z.string().default(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'),
  /** Passend zur Kennung. Ändert sich nur, wenn LINA_USER_AGENT wechselt. */
  LINA_PLATTFORM: z.string().default('macOS'),

  // --- FoodNotify ----------------------------------------------------------
  /**
   * Vier Marken, vier Mandanten, vier Konten. Jeder Zugang sieht nur die
   * Betriebe seiner Marke (geprüft 01.08.2026: das Aposto-Konto zeigt 14
   * Betriebe und kennt keinen Markenwechsel).
   *
   * Die Variablennamen tragen den Markenschlüssel aus `core.marke.schluessel`
   * — `aposto` → `FN_APOSTO_USER`. Wer hier eine Marke ergänzt, ergänzt sie
   * zuerst dort.
   *
   * Alle optional: wer nur Aposto durchsticht, setzt nur Aposto. Was NICHT
   * geht, ist ein halbes Paar — Benutzer ohne Passwort oder umgekehrt bricht
   * den Start ab (geprüft in `laden()`), denn ein halbes Paar ist immer ein
   * Versehen und fiele sonst erst mitten im Backfill auf.
   */
  FN_BASE_URL: z.string().default('https://my.foodnotify.com'),
  FN_APOSTO_USER: z.string().optional(),
  FN_APOSTO_PASSWORD: z.string().optional(),
  FN_ENCHILADA_USER: z.string().optional(),
  FN_ENCHILADA_PASSWORD: z.string().optional(),
  FN_DEUTSCHE_KONZEPTE_USER: z.string().optional(),
  FN_DEUTSCHE_KONZEPTE_PASSWORD: z.string().optional(),
  FN_WILMA_WUNDER_USER: z.string().optional(),
  FN_WILMA_WUNDER_PASSWORD: z.string().optional(),

  // --- Yext ----------------------------------------------------------------
  /**
   * Lesender Zugang zu Bewertungen und Entitäten (Management API v2).
   *
   * Optional, und zwar dauerhaft: der Importer läuft ohne Yext vollständig
   * weiter, die Online-Bewertung ist dann eben die von Hand gepflegte Zahl.
   * Ein fehlender Schlüssel ist deshalb kein Startfehler.
   *
   * WAS DIESER SCHLÜSSEL NICHT ENTSCHEIDET: welche Standorte uns gehören. Das
   * Konto gehört der Family & Friends Marketing und enthält auch fremde
   * Kunden (docs/yext-anbindung.md §1). Maßgeblich ist
   * `manual.betrieb_fremd_id` mit `system = 'yext'`; alles andere, was die API
   * liefert, wird verworfen.
   */
  YEXT_API_KEY: z.string().optional(),
  /** 'me' = das Konto des Schlüssels. Eine echte ID nur als Unterkonto einer Agentur. */
  YEXT_ACCOUNT_ID: z.string().default('me'),
  /**
   * Rechenzentrum. Ein Schlüssel der US-Instanz ist an der EU-Instanz
   * ungültig und umgekehrt — bei einem 401 ist das der erste Verdacht,
   * nicht der Schlüssel.
   */
  YEXT_BASE_URL: z.string().default('https://api.yext.com'),
  /**
   * Pflichtparameter `v` der Management API. Festes Datum in der
   * Vergangenheit: Yext hält alte Versionen stabil, damit sich die
   * Antwortform nicht unter uns weg ändert.
   */
  YEXT_API_VERSION: z.string().regex(/^\d{8}$/).default('20240401'),

  // --- Metabase ------------------------------------------------------------
  /**
   * Eigener Benutzer für die Dashboard-Provisionierung.
   *
   * Bis zum 03.08.2026 lief `metabase/uebernehmen.ts` nur über einen
   * Proxy im Browser: Metabase schickt eine strenge
   * `Content-Security-Policy`, seine eigene Seite darf also keine
   * Anfragen nach außen stellen — und das Skript benutzte deshalb das
   * Sitzungs-Cookie des angemeldeten Menschen. Damit brauchte jede
   * Übernahme jemanden, der einen Browser öffnet.
   *
   * Metabase hat aber einen API-Login (`POST /api/session`). Mit einem
   * eigenen Konto läuft die Übernahme ohne Browser und später auch auf
   * dem Server.
   *
   * ALLE DREI OPTIONAL, und das mit Absicht: fehlen sie, fällt das
   * Skript auf den Browser-Proxy zurück. Wer nichts konfiguriert, verliert
   * nichts.
   *
   * WARUM EIN EIGENES KONTO statt des persönlichen: In Metabases
   * Änderungsverlauf ist dann erkennbar, was vom Importer stammt und was
   * von Hand — und das Passwort eines Menschen steht in keiner Datei.
   * Braucht Admin-Rechte, weil Karten und Dashboards geschrieben werden.
   */
  METABASE_URL: z.string().default('http://localhost:3000'),
  METABASE_USER: z.string().optional(),
  METABASE_PASSWORD: z.string().optional(),

  // --- Tempo -------------------------------------------------------------
  /**
   * Pause zwischen zwei Requests, zufällig aus diesem Bereich.
   *
   * Seit dem 26.07.2026 10–20 s statt 20–40 s. Zwei Messungen tragen das:
   *
   *   * Über 526 Aufrufe gemittelt antwortet LINA in 623 ms, gewartet wurde
   *     30.228 ms — **98 % Leerlauf**. An der Zahl der Anfragen ist nichts zu
   *     sparen, eine Antwort enthält bereits alle 141 Betriebe.
   *   * Ein Backfill über 1.100 Posten dauerte damit knapp zehn Stunden. Ein
   *     Testlauf bei 5–12 s über mehrere hundert Aufrufe blieb ohne jede
   *     Reaktion von LINA — keine 429, keine Verzögerung, keine Abwehrseite.
   *
   * 10–20 s liegt zwischen beidem und in dem Bereich, den auch ein Mensch
   * beim Durchklicken des Report Centers erzeugt.
   *
   * **Weiter zu senken ist keine Optimierung, sondern eine Wette.** Es gibt
   * genau einen Zugang, und eine Sperre wäre nicht rückgängig zu machen. Für
   * einen beaufsichtigten Backfill ist ein schnellerer Takt vertretbar — dann
   * aber über Umgebungsvariablen für diesen einen Lauf, nicht hier.
   */
  TAKT_MIN_MS: z.coerce.number().int().min(0).default(10_000),
  TAKT_MAX_MS: z.coerce.number().int().min(0).default(20_000),

  /**
   * Takt und Budget für FoodNotify — GETRENNT von LINA.
   *
   * Zwei verschiedene Anbieter, zwei verschiedene Verträge, zwei
   * verschiedene Risiken. Eine Drosselung gegenüber LINA soll FoodNotify
   * nicht ausbremsen und umgekehrt; ein Backfill bei FoodNotify darf nicht
   * das Budget verbrauchen, das für LINAs Tagesdaten gedacht ist.
   *
   * Bis zum 02.08.2026 teilten sich beide `TAGESBUDGET`: der Zähler las
   * ALLE Zeilen aus `sync.aufgabe`, gleich von welchem Anbieter. Ein
   * FoodNotify-Backfill mit 36.000 Posten hätte damit rechnerisch LINAs
   * Tagesdaten verhungern lassen — die Priorität rettet sie, das Budget
   * hätte sie trotzdem gedeckelt.
   *
   * WARUM DIE WERTE ANDERS SEIN DÜRFEN. LINAs 10–20 s sind Tarnung: ein
   * einzelner Client, der schneller klickt als ein Mensch, fällt in einem
   * Report Center auf, und es gibt genau einen Zugang. FoodNotify ist ein
   * bezahlter REST-Dienst mit dokumentierten Endpunkten und ~58 ms
   * Antwortzeit — dort ist ein zügigerer Takt kein Risiko, sondern
   * bestimmungsgemäße Nutzung.
   *
   * Ohne gesetzte Variable gelten die LINA-Werte. Das ist Absicht: wer
   * nichts konfiguriert, bekommt das vorsichtigere Verhalten.
   */
  FN_TAKT_MIN_MS: z.coerce.number().int().min(0).optional(),
  FN_TAKT_MAX_MS: z.coerce.number().int().min(0).optional(),
  FN_TAGESBUDGET: z.coerce.number().int().min(1).optional(),

  /**
   * Wie lange der Importer nach einer erkannten Sperre ruht (Stunden).
   *
   * **Die Sperre läuft von selbst ab.** Danach versucht es der Importer ohne
   * Zutun erneut — niemand muss etwas freigeben. Ein Tag ist lang genug, dass
   * eine Tagesbegrenzung bei LINA sicher zurückgesetzt ist, und kurz genug,
   * dass der Rückstand aufholbar bleibt.
   *
   * Die Dauer verdoppelt sich je weiterer Sperre der letzten 24 Stunden,
   * höchstens zweimal: 24 → 48 → 96 Stunden. Wer dreimal am Tag gesperrt
   * wird, hat ein anderes Problem als wer einmal gesperrt wird; dann soll ein
   * Mensch hinsehen, und dafür gibt es `/status`.
   *
   * Schickt LINA einen `Retry-After`-Header, gilt der als Untergrenze.
   */
  SPERRE_PAUSE_STUNDEN: z.coerce.number().min(0.01).default(24),

  /**
   * Dasselbe, aber für den schwersten Fall: die Anmeldung selbst schlägt fehl.
   *
   * Doppelt so lang, weil das ein gesperrtes Konto bedeuten kann und es genau
   * einen Zugang gibt. Auch hier läuft die Sperre von selbst ab — sinnvoll ist
   * trotzdem, dass sich vorher ein Mensch im Browser anmeldet und nachsieht.
   * Die lange Pause ist dafür da, dass bis dahin nichts weiter passiert.
   */
  SPERRE_ANMELDUNG_STUNDEN: z.coerce.number().min(0.01).default(48),

  /**
   * Ab wann `/status` einen Stillstand meldet (Stunden ohne erledigten Posten,
   * obwohl fällige Arbeit in der Schlange liegt).
   *
   * Der Zeitplan läuft stündlich, ein Lauf schafft also normalerweise etwas.
   * Drei Stunden ohne jeden Fortschritt bei vorhandener Arbeit heißt: es
   * klemmt. Ruht der Zugang gerade, zählt das NICHT als Stillstand — dafür
   * gibt es eine eigene Meldung, und zwei Alarme für eine Ursache sind einer
   * zu viel.
   */
  STATUS_STILLSTAND_STUNDEN: z.coerce.number().min(0.1).default(3),
  /**
   * Ab wann `/status` meldet, dass die BWA insgesamt stehengeblieben ist —
   * Monate zwischen dem laufenden Monat und dem jüngsten Monat, den irgendein
   * Betrieb gebucht hat.
   *
   * Bewacht wird damit genau ein Ausfall: `getKennzahlen` liefert ohne volle
   * BWA-Rechte stillschweigend Nullen statt eines Fehlers. Dann rückt die
   * Spitze nie wieder vor, und sonst fällt es niemandem auf.
   *
   * NICHT bewacht wird, wie viele einzelne Betriebe hinterherhängen — das ist
   * Normalzustand und kein Importfehler: am 26.07.2026 hatten 62 von 141
   * Betrieben nie eine gebuchte BWA, zehn weitere tauchen in getKennzahlen
   * überhaupt nicht auf, und 38 der 69 buchenden lagen einen Monat hinter der
   * Spitze. Wer darauf alarmiert, hat eine dauerhaft gelbe Ampel, und die
   * liest nach zwei Wochen niemand mehr. Die Namen stehen in
   * mart.bwa_rueckstand, wenn jemand sie sucht.
   *
   * Drei Monate, weil zwei noch erklärbar sind: am Monatsersten ist der
   * Vormonat regelmäßig noch ungebucht, die Spitze steht dann auf dem
   * Vorvormonat. Gemessen am 26.07.2026: Spitze Juni, also ein Monat.
   */
  STATUS_BWA_RUECKSTAND_MONATE: z.coerce.number().min(1).default(3),
  /**
   * Zweite Bremse: harte Obergrenze pro Kalendertag (UTC).
   *
   * Bewusst ÜBER dem, was der Takt zulässt — sonst stünde der Importer täglich
   * ab dem Erreichen der Grenze still, und genau diese Lücke sollte mit dem
   * Wegfall des Arbeitsfensters verschwinden (25.07.2026).
   *
   * Das Budget bleibt damit, was es sein soll: ein Notfallnetz gegen einen
   * Fehler, der das Tempo aushebelt — keine Alltagsbremse.
   *
   * 3.000 war zum Takt 20–40 s gerechnet (im Mittel 30 s, also ~2.880 Aufrufe
   * in 24 Stunden). Am 26.07.2026 wurde der Takt auf 10–20 s halbiert, das
   * Budget aber nicht mitgezogen — womit aus dem Notfallnetz still die
   * Alltagsbremse wurde. Lauf 10 hat es vorgeführt: 3.802 Posten in 16,9
   * Stunden, dann `Tagesbudget aufgebraucht` um 13:21 Uhr mitten am Tag.
   *
   * Gemessen sind das 16,0 s je Posten, also ~5.400 Aufrufe in 24 Stunden.
   * 6.000 liegt darüber, mit demselben schmalen Abstand wie vorher.
   *
   * Wichtig: Das ändert NICHT die Last je Zeiteinheit. Was LINA sieht, regeln
   * TAKT_MIN_MS/TAKT_MAX_MS — die bleiben unangetastet. Das Budget entscheidet
   * nur, wann der Tag vorzeitig endet. Wer den Takt wieder ändert, muss diesen
   * Wert nachziehen; sonst wiederholt sich derselbe Fehler.
   */
  TAGESBUDGET: z.coerce.number().int().min(1).default(6_000),
  /**
   * Arbeitsfenster in Ortszeit. **Voreinstellung 0–24: durchgehend.**
   *
   * Bis zum 25.07.2026 stand hier 7–23 Uhr, mit der Begründung, ein Client um
   * drei Uhr nachts sei im Log ein Ausreißer. Bewusst revidiert: Der Importer
   * fragt ohnehin nur alle 20–40 Sekunden. Ein gleichmäßig langsamer Strom
   * rund um die Uhr ist unauffälliger als ein Gerät, das jeden Abend
   * schlagartig verstummt und morgens wieder anspringt — eine Kante im Log
   * ist ein Muster, ein flaches Rauschen ist keins.
   *
   * Was das Tempo begrenzt, sind TAKT_* und TAGESBUDGET, nicht die Uhrzeit.
   *
   * Ein Fenster lässt sich jederzeit wieder setzen (z. B. 7 und 23). Die
   * Untergrenze ist inklusive, die Obergrenze exklusiv; 0–24 heißt „immer".
   */
  FENSTER_VON_STUNDE: z.coerce.number().int().min(0).max(23).default(0),
  FENSTER_BIS_STUNDE: z.coerce.number().int().min(1).max(24).default(24),

  // --- Fehlerverhalten ---------------------------------------------------
  /**
   * Zeitlimit je HTTP-Anfrage an LINA.
   *
   * Ohne dieses Limit hängt ein einzelner Aufruf, der nie antwortet, den
   * gesamten Worker auf — `fetch` wartet von sich aus unbegrenzt. Am
   * 25.07.2026 genau so passiert: `getUmsatzbericht:speisen` stand über zehn
   * Minuten „in Arbeit", während der Posten davor 614 ms gebraucht hatte.
   *
   * Besonders übel im Zusammenspiel mit der Advisory-Sperre in
   * `src/sync/worker.ts`: Der hängende Lauf hält die Sperre, jeder folgende
   * Lauf wird abgewiesen, und `sync.haengende_posten_freigeben()` läuft nur
   * beim START eines Laufs — der nie zustande kommt. Der Importer wäre
   * dauerhaft still, ohne dass jemand etwas merkt.
   *
   * 60 s ist reichlich: die beobachteten Antwortzeiten liegen bei
   * Millisekunden. Ein Abbruch ist ein wiederholbarer Fehler, der Posten
   * kommt also mit Wiedervorlage zurück.
   */
  ANFRAGE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),

  MAX_VERSUCHE: z.coerce.number().int().min(1).default(4),

  /**
   * Wie oft ein aufgegebener Posten vom naechtlichen Lauf zurueckgeholt wird.
   *
   * `aufgegeben` setzt `erledigt_am` — bis zum 13.08.2026 sah den Posten
   * danach kein Code je wieder an. In Produktion lagen so 275
   * `fn:bestellpositionen` still, und mit ihnen 322 Bestellungen ueber
   * 686.535,93 EUR ohne eine einzige Position.
   *
   * Drei, nicht unbegrenzt: ein Posten, der wirklich nicht holbar ist, kostet
   * sonst jede Nacht MAX_VERSUCHE Aufrufe und kommt nie zur Ruhe — derselbe
   * Bau wie der 403-Zweig im Worker, der seit neun Tagen bei netto ±0 steht.
   * Drei Anlaeufe an drei Tagen unterscheiden einen Aussetzer der Gegenstelle
   * von einer Quellengrenze; was danach noch steht, ist eine.
   *
   * Und drei, nicht null: aufgegeben ist selten. Gemessen am 13.08.2026 sind
   * es 275 von 169.000 erledigten Posten, also 0,16 % — der Rueckhol-Vorrat
   * kann die Budgets nicht sprengen.
   */
  MAX_WIEDERBELEBUNGEN: z.coerce.number().int().min(0).default(3),
  /** Ab so vielen Fehlern in Folge pausiert der Worker den ganzen Lauf. */
  ABBRUCH_NACH_FEHLERN: z.coerce.number().int().min(1).default(10),

  /** Obergrenze je Lauf. 0 = unbegrenzt, dann läuft der Worker bis zum Fensterende. */
  MAX_POSTEN_PRO_LAUF: z.coerce.number().int().min(0).default(0),

  /**
   * Wie viele Tage rückwärts der tägliche Lauf nachholt.
   *
   * LINAs Konzernberichte füllen sich über mehrere Tage. Am 26.07.2026 gegen
   * die echte Instanz gemessen:
   *
   *     25.07.   0 von 141 Betrieben mit Umsatz          0 €
   *     24.07.   0                                       0 €
   *     23.07.   0                                       0 €
   *     22.07.   0                                       0 €
   *     21.07.  21                                  13.268 €
   *     20.07.  51                                 236.999 €
   *     19.07.  55                                 351.168 €
   *
   * „Gestern" zu holen liefert also verlässlich Nullen — und weil der Posten
   * danach als erledigt gilt und `historie_einreihen()` bewusst nichts
   * Erledigtes noch einmal einreiht, bliebe dieser Tag für immer auf null.
   * Eine Lücke, die wie ein Umsatz von null aussieht.
   *
   * Deshalb holt der tägliche Lauf ein gleitendes Fenster. Die Zieltabellen
   * sind Upserts, ein zweiter Abruf korrigiert den ersten also einfach. Zehn
   * Tage sind reichlich über der beobachteten Anlaufzeit und kosten 8
   * Endpunkte × 10 Tage = 80 Aufrufe am Tag — bei einem Tagesbudget von 6.000
   * fällt das nicht ins Gewicht.
   */
  NACHZUEGLER_TAGE: z.coerce.number().int().min(1).default(10),

  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * Wie oft eine Fortschrittszeile geschrieben wird — jeder n-te Posten.
   *
   * Der Anlass: ein gesunder Lauf war auf `info` vollkommen still. Erfolge
   * gingen nach `debug`, und zwischen zwei Posten liegen 20–40 Sekunden. Am
   * 26.07.2026 hat genau das wie ein Hänger ausgesehen, war aber keiner —
   * nachweisbar erst, nachdem der Lauf mit LOG_LEVEL=debug neu gestartet
   * wurde. Ein Betriebszustand, den man nur durch Neustart feststellen kann,
   * ist keiner.
   *
   * Die Voreinstellung unterscheidet lokal von Produktion, ohne dass jemand
   * etwas setzen muss: hängt an stdout ein Terminal, will da jemand zusehen —
   * dann jede Zeile. Im Container (Dokploy, kein TTY) alle 50 Posten, also
   * etwa alle 25 Minuten. Das ist Lebenszeichen genug und flutet kein Log.
   *
   * 0 schaltet die Zeilen ganz ab.
   */
  FORTSCHRITT_ALLE: z.coerce.number().int().min(0)
    .default(process.stdout.isTTY ? 1 : 50),
})

function laden() {
  const r = Schema.safeParse(process.env)
  if (!r.success) {
    const details = r.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Konfiguration unvollständig:\n${details}`)
  }
  if (r.data.TAKT_MIN_MS > r.data.TAKT_MAX_MS) {
    throw new Error('TAKT_MIN_MS darf nicht größer als TAKT_MAX_MS sein')
  }
  // Dieselbe Prüfung für FoodNotify — auf den EFFEKTIVEN Werten, damit
  // ein einzeln gesetztes FN_TAKT_MIN_MS gegen LINAs Höchstwert geprüft
  // wird und nicht stillschweigend gegen sich selbst.
  const fnMin = r.data.FN_TAKT_MIN_MS ?? r.data.TAKT_MIN_MS
  const fnMax = r.data.FN_TAKT_MAX_MS ?? r.data.TAKT_MAX_MS
  if (fnMin > fnMax) {
    throw new Error(
      `FN_TAKT_MIN_MS (${fnMin} ms) darf nicht größer als FN_TAKT_MAX_MS (${fnMax} ms) sein`)
  }
  if (r.data.FENSTER_VON_STUNDE >= r.data.FENSTER_BIS_STUNDE) {
    throw new Error('FENSTER_VON_STUNDE muss vor FENSTER_BIS_STUNDE liegen')
  }
  /**
   * Halbe FoodNotify-Paare sind immer ein Versehen — ein vertipptes
   * `FN_APOSTO_PASSWORT` statt `_PASSWORD` sähe sonst aus wie „Marke nicht
   * konfiguriert" und fiele erst auf, wenn der Backfill die Marke still
   * überspringt.
   */
  for (const m of FN_MARKEN) {
    const user = r.data[`FN_${m.env}_USER` as keyof typeof r.data]
    const pass = r.data[`FN_${m.env}_PASSWORD` as keyof typeof r.data]
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error(
        `FN_${m.env}_USER und FN_${m.env}_PASSWORD müssen beide gesetzt sein oder beide fehlen — ` +
        `gesetzt ist nur ${user ? 'der Benutzer' : 'das Passwort'}`)
    }
  }
  // Dasselbe für Metabase, aus demselben Grund: ein halbes Paar sieht aus
  // wie „nicht konfiguriert" und fiele erst auf, wenn die Übernahme
  // stillschweigend wieder den Browser verlangt.
  if (Boolean(r.data.METABASE_USER) !== Boolean(r.data.METABASE_PASSWORD)) {
    throw new Error(
      'METABASE_USER und METABASE_PASSWORD müssen beide gesetzt sein oder beide fehlen — ' +
      `gesetzt ist nur ${r.data.METABASE_USER ? 'der Benutzer' : 'das Passwort'}`)
  }
  return r.data
}

/**
 * Die vier Marken, für die es Zugangsdaten geben kann. `schluessel` muss
 * `core.marke.schluessel` entsprechen — der Wert wandert als Mandant in
 * `sync.warteschlange.marke_key` und zurück.
 */
const FN_MARKEN = [
  { schluessel: 'aposto',            env: 'APOSTO' },
  { schluessel: 'enchilada',         env: 'ENCHILADA' },
  { schluessel: 'deutsche_konzepte', env: 'DEUTSCHE_KONZEPTE' },
  { schluessel: 'wilma_wunder',      env: 'WILMA_WUNDER' },
] as const

export type FnZugang = { schluessel: string; user: string; password: string }

/**
 * Die Marken, für die Zugangsdaten vorliegen. Marken ohne Eintrag werden
 * beim Einreihen übersprungen — sichtbar geloggt, nicht still.
 */
/**
 * Die tatsächlich geltenden FoodNotify-Grenzen.
 *
 * Eine Stelle, an der der Rückfall auf die LINA-Werte steht — sonst
 * driften Client, Startprotokoll und Prüfung auseinander, und jede Seite
 * behauptet ein anderes Tempo.
 */
export function fnGrenzen(c: Config = config) {
  return {
    taktMin: c.FN_TAKT_MIN_MS ?? c.TAKT_MIN_MS,
    taktMax: c.FN_TAKT_MAX_MS ?? c.TAKT_MAX_MS,
    tagesbudget: c.FN_TAGESBUDGET ?? c.TAGESBUDGET,
    /** Sind eigene Werte gesetzt, oder gelten LINAs? */
    eigen: c.FN_TAKT_MIN_MS !== undefined || c.FN_TAKT_MAX_MS !== undefined
        || c.FN_TAGESBUDGET !== undefined,
  }
}

export function fnZugaenge(c: Config = config): FnZugang[] {
  return FN_MARKEN.flatMap(m => {
    const user = c[`FN_${m.env}_USER` as keyof Config] as string | undefined
    const password = c[`FN_${m.env}_PASSWORD` as keyof Config] as string | undefined
    return user && password ? [{ schluessel: m.schluessel, user, password }] : []
  })
}

export type Config = z.infer<typeof Schema>
export const config: Config = laden()

/** Nie das Passwort loggen — diese Sicht ist die einzige, die ausgegeben wird. */
export function konfigZumLoggen(c: Config = config) {
  return {
    baseUrl: c.LINA_BASE_URL,
    user: c.LINA_USER,
    /**
     * Die LÄNGE, nie der Wert. Sieht nach Kleinigkeit aus, hat aber am
     * 25.07.2026 drei Fehlanmeldungen gekostet: `.env` enthielt ein Passwort
     * mit `$` und `#`, unquotiert. Bun expandiert `$name` (auch in einfachen
     * Anführungszeichen!) und behandelt `#` als Kommentaranfang — aus 25
     * Zeichen wurden stillschweigend 9, und LINA meldete völlig zu Recht
     * „Benutzername oder Passwort ist falsch!".
     *
     * Eine gemeldete Länge, die nicht zum tatsächlichen Passwort passt, zeigt
     * das sofort. Richtig in der `.env`: in Anführungszeichen UND `$` als `\$`
     * maskieren — quotieren allein reicht bei Bun nicht.
     */
    passwortLaenge: c.LINA_PASSWORD.length,
    system: c.LINA_SYSTEM,
    // „lina"-Präfix, seit Takt und Budget je Anbieter gelten: ohne den
    // Zusatz läse man die Zahl als Tempo des ganzen Importers.
    linaTakt: `${c.TAKT_MIN_MS}–${c.TAKT_MAX_MS} ms`,
    linaTagesbudget: c.TAGESBUDGET,
    fnTakt: `${fnGrenzen(c).taktMin}–${fnGrenzen(c).taktMax} ms`
      + (fnGrenzen(c).eigen ? '' : ' (von LINA geerbt)'),
    fnTagesbudget: fnGrenzen(c).tagesbudget,
    fenster: c.FENSTER_VON_STUNDE === 0 && c.FENSTER_BIS_STUNDE === 24
      ? 'durchgehend'
      : `${c.FENSTER_VON_STUNDE}–${c.FENSTER_BIS_STUNDE} Uhr`,
    hashverfahren: c.LINA_PASSWORD_HASH,
    maxVersuche: c.MAX_VERSUCHE,
    fortschritt: c.FORTSCHRITT_ALLE === 0
      ? 'aus'
      : c.FORTSCHRITT_ALLE === 1 ? 'jeder Posten' : `jeder ${c.FORTSCHRITT_ALLE}. Posten`,
    /**
     * Je konfigurierter FoodNotify-Marke Benutzer und Passwortlänge — die
     * LÄNGE aus demselben Grund wie bei LINA oben: eine falsche Zahl zeigt
     * sofort, dass Bun das Passwort beim Einlesen der `.env` verstümmelt hat
     * (`$` expandiert, `#` beginnt Kommentar).
     */
    foodnotify: fnZugaenge(c).length === 0
      ? 'keine Marke konfiguriert'
      : fnZugaenge(c).map(z => `${z.schluessel}: ${z.user} (Passwortlänge ${z.password.length})`),
  }
}
