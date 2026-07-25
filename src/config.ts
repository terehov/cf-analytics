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
  /** Pause zwischen zwei Requests, zufällig aus diesem Bereich. */
  TAKT_MIN_MS: z.coerce.number().int().min(0).default(20_000),
  TAKT_MAX_MS: z.coerce.number().int().min(0).default(40_000),
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
  MAX_VERSUCHE: z.coerce.number().int().min(1).default(4),
  /** Ab so vielen Fehlern in Folge pausiert der Worker den ganzen Lauf. */
  ABBRUCH_NACH_FEHLERN: z.coerce.number().int().min(1).default(10),

  /** Obergrenze je Lauf. 0 = unbegrenzt, dann läuft der Worker bis zum Fensterende. */
  MAX_POSTEN_PRO_LAUF: z.coerce.number().int().min(0).default(0),

  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
  }
}
