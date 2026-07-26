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
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'),
  /** Passend zur Kennung. Ändert sich nur, wenn LINA_USER_AGENT wechselt. */
  LINA_PLATTFORM: z.string().default('Windows'),

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
   * Wie lange der Importer nach einer erkannten Sperre ruht (Stunden).
   *
   * Die Dauer verdoppelt sich je weiterer Sperre der letzten 24 Stunden,
   * gedeckelt beim Sechzehnfachen — aus 6 werden 12, 24, 48, 96. Wer zweimal
   * am Tag gesperrt wird, hat ein anderes Problem als wer einmal gesperrt
   * wird, und irgendwann soll ein Mensch hinsehen. Schickt LINA einen
   * `Retry-After`-Header, gilt der als Untergrenze.
   */
  SPERRE_PAUSE_STUNDEN: z.coerce.number().min(0.01).default(6),

  /**
   * Dasselbe, aber für den schwersten Fall: die Anmeldung selbst schlägt fehl.
   *
   * Deutlich länger, weil das ein gesperrtes Konto bedeuten kann und es genau
   * einen Zugang gibt. Hier hilft kein Abwarten, sondern nur ein Mensch, der
   * sich im Browser anmeldet und nachsieht — die lange Pause ist dafür da,
   * dass bis dahin nichts weiter passiert.
   */
  SPERRE_ANMELDUNG_STUNDEN: z.coerce.number().min(0.01).default(24),
  /**
   * Zweite Bremse: harte Obergrenze pro Kalendertag (UTC).
   *
   * Bewusst ÜBER dem, was der Takt zulässt: 20–40 s ergeben im Mittel 30 s,
   * also ~2.880 Aufrufe in 24 Stunden. Mit 3.000 bremst der Takt, nicht das
   * Budget — sonst stünde der Importer täglich ab dem Erreichen der Grenze
   * still, und genau diese Lücke sollte mit dem Wegfall des Arbeitsfensters
   * verschwinden (25.07.2026).
   *
   * Das Budget bleibt damit, was es sein soll: ein Notfallnetz gegen einen
   * Fehler, der das Tempo aushebelt — keine Alltagsbremse.
   */
  TAGESBUDGET: z.coerce.number().int().min(1).default(3_000),
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
   * Endpunkte × 10 Tage = 80 Aufrufe am Tag — bei einem Tagesbudget von 3.000
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
  if (r.data.FENSTER_VON_STUNDE >= r.data.FENSTER_BIS_STUNDE) {
    throw new Error('FENSTER_VON_STUNDE muss vor FENSTER_BIS_STUNDE liegen')
  }
  return r.data
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
    takt: `${c.TAKT_MIN_MS}–${c.TAKT_MAX_MS} ms`,
    tagesbudget: c.TAGESBUDGET,
    fenster: c.FENSTER_VON_STUNDE === 0 && c.FENSTER_BIS_STUNDE === 24
      ? 'durchgehend'
      : `${c.FENSTER_VON_STUNDE}–${c.FENSTER_BIS_STUNDE} Uhr`,
    hashverfahren: c.LINA_PASSWORD_HASH,
    maxVersuche: c.MAX_VERSUCHE,
    fortschritt: c.FORTSCHRITT_ALLE === 0
      ? 'aus'
      : c.FORTSCHRITT_ALLE === 1 ? 'jeder Posten' : `jeder ${c.FORTSCHRITT_ALLE}. Posten`,
  }
}
