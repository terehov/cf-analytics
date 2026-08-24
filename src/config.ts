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

  // --- Bounti --------------------------------------------------------------
  /**
   * Lesender Zugang zum Schulungssystem (External API v1).
   *
   * Optional, und zwar dauerhaft — wie Yext und das Wetter. Der Importer
   * laeuft ohne Bounti vollstaendig weiter; die Schulungs- und Auditkacheln
   * bleiben dann leer, und das ist ein sichtbarer Zustand
   * (mart.quelle_zulauf), kein Startfehler.
   *
   * BEARER, KEIN BENUTZER UND KEIN PASSWORT. Bounti vergibt API-Schluessel
   * ueber den Kundenservice; es gibt keine Anmeldung, kein Ablaufdatum im
   * Schluessel und keine Erneuerung zur Laufzeit. Ein 403 INVALID_API_KEY
   * ist deshalb immer ein Fall fuer einen Menschen und nie fuer eine
   * Wiederholungsschleife.
   *
   * WAS DIESER SCHLUESSEL NICHT ENTSCHEIDET: welche Standorte zu welchem
   * Betrieb gehoeren. Massgeblich ist manual.betrieb_fremd_id mit
   * system = 'bounti' — dieselbe Konstruktion wie bei Yext, aus demselben
   * Grund: die Namen stimmen nicht ueberein.
   */
  BOUNTI_API_TOKEN: z.string().optional(),
  BOUNTI_BASE_URL: z.string().default('https://api.bounti.co'),

  /**
   * Wie viele Zeilen eine Seite tragen soll.
   *
   * Die Spezifikation nennt die Voreinstellung 20 und eine Obergrenze von
   * 100 nur bei einem einzigen Endpunkt. 100 ist deshalb ein Versuch, kein
   * gesichertes Wissen — der Client nimmt bei einem 400 zu `limit` dauerhaft
   * 20 (src/bounti/client.ts). Wer den Wert hier senkt, spart nichts ausser
   * Zeit; wer ihn erhoeht, riskiert diesen Rueckfall bei jedem Lauf.
   */
  BOUNTI_SEITE: z.coerce.number().int().min(1).max(100).default(100),

  /** Rueckhalt gegen einen Seitenlauf, der nicht endet. 500 Seiten sind bei */
  /** 100 Zeilen 50.000 Zeilen — mehr als jede Liste dieser Anbindung hat.   */
  BOUNTI_SEITEN_MAX: z.coerce.number().int().min(1).default(500),

  /**
   * Das Aufrufbudget EINES Laufs.
   *
   * Bountis Limit sind 3.000 Anfragen je Stunde, und der Nachlauf laeuft
   * hoechstens einmal am Tag — 1.200 lassen also reichlich Luft und decken
   * den taeglichen Bedarf um ein Vielfaches:
   *
   *   Standorte, Rollen, Kurse, Pfade, Audits, Fortschritt   ~10
   *   Mitarbeitende (aktiv und archiviert, 100 je Seite)     ~40
   *   Auditberichte inkrementell                             ~5
   *   Zuweisungen (Rotation, siehe unten)                    Rest
   *
   * Ist es aufgebraucht, hoert der Lauf geordnet auf; was fehlt, steht in
   * mart.bounti_zuweisung_stand und wird in der naechsten Nacht geholt.
   * Auf 0 laesst sich nichts stellen — dafuer gibt es das Weglassen des
   * Schluessels.
   */
  BOUNTI_AUFRUFE_MAX: z.coerce.number().int().min(1).default(1_200),

  /**
   * Wie viel Kontingent uebrig bleiben soll.
   *
   * Bounti meldet den Rest in jeder Antwort (RateLimit-Remaining). Faellt er
   * unter diesen Wert, sagt der Lauf es einmal deutlich. Der Grund ist nicht
   * Hoeflichkeit: Bounti ist ein System im laufenden Betrieb, und wer das
   * Stundenkontingent leerraeumt, sperrt fuer den Rest der Stunde auch die
   * App der Mitarbeitenden aus, wenn sie am selben Schluessel haengt.
   */
  BOUNTI_RESERVE: z.coerce.number().int().min(0).default(200),

  /**
   * Wie viele Kurse und Lernpfade eine Nacht hoechstens im Detail holt.
   *
   * DIE OBERGRENZE STATT DES HANDBEFEHLS (Entscheidung vom 14.08.2026).
   * Zuweisungen lassen sich nicht inkrementell holen: der Endpunkt kennt
   * weder `after` noch einen Aenderungszeitstempel, es gibt nur "alle,
   * seitenweise". Der Lauf arbeitet deshalb je Nacht so viele Lerneinheiten
   * ab, die am laengsten nicht geholten zuerst — nie geholte vor veralteten.
   *
   * HUNDERTZWANZIG, und das ist seit dem 24.08.2026 nachgemessen statt
   * geschaetzt. Der erste echte Zugriff zeigte den Katalog:
   *
   *   441 Kurse + 29 Pfade         = 470 Lerneinheiten
   *   Stichprobe: 207 Zuweisungen  = 3 Seiten a 100
   *   also rund 1.400 Aufrufe fuer einen vollstaendigen Durchgang
   *
   * Mit den urspruenglich angesetzten 40 haette der erste Bestand ZWOELF
   * NAECHTE gebraucht — und waehrend dieser zwoelf Naechte zeigte jede
   * Erfuellungsquote zu wenig, ohne dass man es ihr ansieht. Mit 120 sind
   * es vier Naechte, bei rund 360 Aufrufen je Nacht: ein Viertel des
   * Laufbudgets (1.200) und ein Achtel von Bountis Stundenlimit.
   *
   * Danach altert keine Lerneinheit laenger als vier Tage nach.
   * mart.bounti_zuweisung_stand sagt, ob das reicht.
   */
  BOUNTI_LERNEINHEITEN_JE_LAUF: z.coerce.number().int().min(0).default(120),

  /**
   * Abstand zwischen zwei Bounti-Nachlaeufen (Stunden).
   *
   * 20 statt 24, aus demselben Grund wie bei Yext: bei genau 24 rutscht der
   * Lauf taeglich eine Stunde spaeter und faellt irgendwann ganz aus dem
   * Zeitfenster. Der Sync-Lauf ist stuendlich; ein stuendlicher Bounti-Lauf
   * waere 24-mal dieselbe Antwort — niemand schliesst zur vollen Stunde
   * einen Kurs ab.
   */
  BOUNTI_ABSTAND_STUNDEN: z.coerce.number().int().min(1).default(20),

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

  /**
   * Nach wie vielen Tagen dauerhafter Ablehnung (HTTP 403) ein FoodNotify-Posten
   * geschlossen wird — mit `ergebnis = 'kein_zugriff'`, nicht `aufgegeben`.
   *
   * DER ZWEIG, DEN ES BEENDET. `worker.ts` vertagt einen 403 um 24 Stunden und
   * nimmt dem Posten dabei einen Versuch ab (`versuche - 1`), weil
   * `posten_holen()` vorher hochgezählt hat. Netto ±0 pro Tag — der Posten
   * kommt nie am Aufgeben-Zweig vorbei. Das ist bewusst so gebaut (ein
   * fehlender Anspruch kann nachgetragen werden), hatte aber kein Ende:
   * Posten 28629 lag vom 02.08. bis zum 14.08.2026 darin und stand immer noch
   * auf `versuche = 0`.
   *
   * VIERZEHN TAGE, weil das die Frist ist, in der ein nachgetragener Anspruch
   * realistisch ankommt. Kürzer wäre eine Wette gegen die Verwaltung; länger
   * hiesse, dass eine fremde Kostenstelle die Ladestandsanzeige einen Monat
   * lang einfärbt.
   *
   * DIE GEGENPROBE STEHT IM WORKER: geschlossen wird nur, wenn derselbe
   * Endpunkt derselben Marke in den letzten 24 Stunden irgendwo ein `ok`
   * hatte. Sagt der Zugang ÜBERALL nein, ist es das Konto und keine Ressource
   * — dann bleibt der Posten liegen, statt still weggeräumt zu werden.
   */
  SPERRE_AUFGEBEN_TAGE: z.coerce.number().int().min(1).default(14),

  /**
   * Nach wie vielen Tagen der Yext-Nachlauf das volle Fenster holt statt der
   * drei laufenden Monate — und die Zuordnung neu abgleicht.
   *
   * WAS DAMIT AUFHÖRT, HANDARBEIT ZU SEIN. Bis zum 14.08.2026 gab es dafür
   * zwei Befehle: `bun run yext --voll` (25 Monate) und
   * `bun run yext:zuordnen --schreiben`. Beide liefen zuletzt am 03.08.2026,
   * und beides sah man den Daten nicht an: alle Stände vor Mai 2026 trugen
   * denselben `geladen_am`, und sieben operative Betriebe hatten keine
   * Yext-Zuordnung — sie fehlten in jeder Bewertungstabelle.
   *
   * WARUM ÜBERHAUPT EIN VOLLABGLEICH. Ein Stand ist kumuliert: der März
   * ändert sich nicht mehr, wenn im August eine Bewertung dazukommt.
   * **Gelöschte** Bewertungen ändern aber auch alte Stände, und die sieht das
   * Drei-Monats-Fenster nie.
   *
   * DREISSIG TAGE, weil der Vollabgleich rund 3.300 Aufrufe kostet statt 400.
   * Das Stundenlimit der Yext Management API liegt bei 5.000; einmal im Monat
   * passt das, ohne die Drosselung anzufassen. Der Takt hängt an einem Merker
   * und nicht am Monatsersten — sonst machte der Ausfall eines einzigen Laufs
   * den Ausfall eines ganzen Monats.
   */
  YEXT_VOLLABGLEICH_TAGE: z.coerce.number().int().min(1).default(30),

  /**
   * Wie viele Jahre im Voraus Feiertage und Schulferien geholt werden.
   *
   * `manual.feiertag` reicht bis zum 26.12.2027, `manual.schulferien` bis zum
   * 11.01.2028 — beide einmal befüllt, von keinem Code fortgeschrieben. Das
   * ist die gefährliche Sorte Frist: sie läuft irgendwann aus, und wer dann
   * auf die Umsatzentwicklung sieht, vergleicht einen Feiertag mit einem
   * Werktag, ohne dass etwas rot wird.
   *
   * Drei Jahre, weil die Länder ihre Ferientermine so weit im Voraus
   * veröffentlichen (am 14.08.2026 nachgesehen: 2029 vollständig) — und weil
   * ein Vorlauf, der kürzer ist als die Zeit zwischen zwei Blicken auf diese
   * Tabelle, keiner ist.
   *
   * DER WERT GEHT NICHT IN EINE ANFRAGE. Die Schnittstelle beantwortet
   * höchstens 1095 Tage am Stück; an dieser Grenze ist der Nachzug vom 14. bis
   * zum 20.08.2026 jede Nacht gescheitert. `abrufplan()` in `pflege/kalender.ts`
   * zerlegt den Vorlauf seither in Kalenderjahre — jeder Wert bis 10 ist
   * dadurch wieder gefahrlos.
   */
  KALENDER_VORLAUF_JAHRE: z.coerce.number().int().min(1).max(10).default(3),

  /** Abstand zwischen zwei Kalenderabgleichen. Ein Feiertag verschiebt sich nicht. */
  KALENDER_ABSTAND_TAGE: z.coerce.number().int().min(1).default(30),

  /**
   * Wie viele Abrufe ein Lauf je Endpunkt höchstens macht.
   *
   * KEINE DROSSEL, SONDERN EIN DECKEL. Der laufende Bedarf sind 16 Länder mal
   * vier Jahre, also 64 — die Grenze greift nur, wenn zusätzlich Historie
   * fehlt: eine leere Datenbank braucht beim ersten Mal 16 mal zehn Jahre.
   * Was über den Deckel läuft, ist das älteste Jahr und fehlt beim nächsten
   * Lauf immer noch; der Rückstand baut sich also von selbst ab, statt dass
   * jemand einen Nachhol-Befehl gibt.
   */
  KALENDER_ABRUFE_MAX: z.coerce.number().int().min(1).default(200),

  /** Ab welchem Tag die Historie vollständig sein soll. */
  HISTORIE_AB: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2018-01-01'),

  /**
   * Wie viele fehlende Geschäftstage der nächtliche Lauf höchstens nachholt.
   *
   * WAS DAMIT AUFHÖRT, HANDARBEIT ZU SEIN. `bun run einreihen --historie` war
   * der letzte Backfill, den ein Mensch anstoßen musste. Am 14.08.2026
   * nachgemessen ist die Historie der acht alten Tagesendpunkte **lückenlos**
   * seit 2018-01-01 — der Befehl hatte nichts mehr zu tun. Mit den acht neuen
   * Hauptsparten (`0077`) hat er wieder etwas: rund 3.100 Tage × 8 Endpunkte,
   * die es sonst erst ab heute gäbe.
   *
   * ZWEITAUSEND, weil der Rest bei diesem Tempo in gut zwei Wochen steht und
   * das Tagesbudget dabei nie in die Nähe der Grenze kommt:
   *
   *   laufender Betrieb   ~184
   *   Nachholen           2.000
   *                       ~2.184 von 10.500
   *
   * NEUESTE ZUERST. Ein Backfill, der vorne anfängt, liefert das Nützlichste
   * zuletzt — und wenn er abbricht, fehlt genau das. Rückwärts ist nach der
   * ersten Nacht der letzte Monat da.
   *
   * Auf 0 gesetzt hört das Nachholen auf, ohne dass jemand Code anfasst. Das
   * ist die Notbremse; ein Handbefehl ist es nicht mehr.
   */
  HISTORIE_JE_LAUF: z.coerce.number().int().min(0).default(2_000),

  /**
   * Wetter-Backfill: wie viele ORTSJAHRE eine Nacht höchstens holt.
   *
   * Ein Ortsjahr ist genau EIN Aufruf gegen Bright Sky — die Schnittstelle
   * liefert ein volles Jahr in einer Antwort (8.737 Stundenwerte für 2025,
   * 5,1 MB, am 20.08.2026 nachgemessen). Die Einheit ist deshalb der Aufruf
   * und nicht der Ort: sie begrenzt genau das, was Last erzeugt.
   *
   * ABWEICHUNG VOM PLAN, mit Absicht. `docs/plan-kalender-wetter.md` nennt
   * `WETTER_BACKFILL_ORTE_PRO_NACHT` mit Vorgabe 10. Ein Ort trägt aber neun
   * Jahre, also neun Aufrufe — die Zahl im Namen hätte um den Faktor neun
   * danebengelegen, und eine Obergrenze, die etwas anderes begrenzt als ihr
   * Name sagt, ist keine.
   *
   * SECHZIG: 48 Gitterpunkte × 9 Jahre sind 432 Ortsjahre, also gut sieben
   * Nächte. Dazu die 48 Aufrufe des rollierenden Fensters — zusammen unter
   * 110 Aufrufen je Nacht gegen einen Dienst, der ganze Jahre am Stück
   * ausliefert.
   *
   * NEUESTE ZUERST, aus demselben Grund wie bei HISTORIE_JE_LAUF: bricht es
   * ab, fehlt die alte Historie und nicht das laufende Jahr.
   *
   * Auf 0 gesetzt hört das Nachholen auf. Das ist die Notbremse; ein
   * Handbefehl ist es nicht.
   */
  WETTER_BACKFILL_JE_LAUF: z.coerce.number().int().min(0).default(60),

  /**
   * Das rollierende Fenster für das Wetter (Tage).
   *
   * DWD-Stationen melden nach und korrigieren; ein einmal geholter Tag ist
   * nicht endgültig. Vierzehn Tage sind ein Kompromiss aus „Korrekturen
   * einsammeln" und „48 Aufrufe je Nacht" — eine Anfrage je Gitterpunkt deckt
   * das ganze Fenster ab, die Zahl der Aufrufe hängt also nicht daran.
   */
  WETTER_FENSTER_TAGE: z.coerce.number().int().min(1).default(14),

  /**
   * Das rollierende Fenster für das Auffrischen der Bestelldetails (Tage).
   *
   * DER BEFUND DAHINTER. Am 13.08.2026 in Produktion gemessen: von 66.966
   * Bestellungen wurde JEDE GENAU EINMAL im Detail geholt, keine einzige je
   * erneut (66.966 Aufgaben, 66.966 verschiedene `orderId`, 0 mehrfach).
   * Liefermenge, Lieferdatum, Belegnummer und alle Preisstände standen damit
   * auf dem Stand des ersten Abrufs — in den Einkaufssichten also
   * Bestellmengen, wo Liefermengen stehen sollten.
   *
   * 45 Tage, weil eine Bestellung so lange nach dem Bestelldatum noch
   * geliefert, korrigiert und abgerechnet wird. Gemessen sind das 2.981
   * nicht-finale Bestellungen und damit 5.962 Aufrufe je Nacht — 4,3 % des
   * FoodNotify-Tagesbudgets von 140.000, bei heute rund 200 verbrauchten.
   */
  BESTELLDETAIL_FENSTER_TAGE: z.coerce.number().int().min(1).default(45),

  /**
   * Wie weit zurück der eingefrorene Altbestand nachgeholt wird (Monate).
   *
   * Entscheidung 5 (Eugene, 13.08.2026): zwölf Monate, nicht der ganze
   * Bestand. Gemessen sind das 21.737 nicht-finale Bestellungen → 43.474
   * Aufrufe; der ganze nicht-finale Bestand wären 63.616 → 127.232 und damit
   * fast das gesamte Tagesbudget über drei Nächte.
   */
  BESTELLDETAIL_NACHHOLTIEFE_MONATE: z.coerce.number().int().min(1).default(12),

  /**
   * Obergrenze je Lauf und Marke — und zugleich der ganze „Nachholauf".
   *
   * ER IST KEIN BEFEHL. Der Nachtrag sah ihn als Handbefehl neben dem
   * Nachtlauf vor, wie die Phase-1-Backfills. Die Entscheidung vom
   * 13.08.2026 gilt aber weiter und ist stärker: kein Befehl auf dem Server.
   * Eine Reparatur, die ein Mensch anstoßen muss, ist eine Verabredung — sie
   * fällt irgendwann aus, und ihr Ausfall sieht aus wie Ruhe.
   *
   * Stattdessen nimmt der normale Lauf höchstens so viele Bestellungen,
   * JÜNGSTE ZUERST. Damit ist das rollierende Fenster (2.981) immer zuerst
   * bedient, und der Rest arbeitet sich über die folgenden Nächte ab. Danach
   * fällt der Verbrauch von selbst auf das Fenster zurück — nichts muss
   * abgeschaltet werden.
   *
   * 11.000 sind 22.000 Aufrufe, 15,7 % des Tagesbudgets, bei gemessenem Takt
   * von 200–500 ms rund zwei Stunden. Die 21.737 des Nachholaufs sind damit
   * nach zwei Nächten durch — die Zahl aus Entscheidung 5.
   */
  BESTELLDETAIL_JE_LAUF: z.coerce.number().int().min(0).default(11_000),

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
    /**
     * Die LÄNGE, nie der Wert — dieselbe Begründung wie beim LINA-Passwort
     * weiter oben. Ein Bearer-Token ist derselben Falle ausgesetzt: steht es
     * unquotiert in der `.env` und enthält ein `$` oder `#`, kürzt Bun es
     * still, und Bounti antwortet völlig zu Recht mit 403 INVALID_API_KEY.
     * Eine gemeldete Länge, die nicht zum hinterlegten Token passt, zeigt
     * das sofort.
     */
    bounti: c.BOUNTI_API_TOKEN
      ? `konfiguriert (Tokenlänge ${c.BOUNTI_API_TOKEN.length})`
      : 'kein Token',
  }
}
