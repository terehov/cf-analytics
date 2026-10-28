/**
 * Nutzer, Clients, Codes und Tokens — alles, was die Anmeldung speichert.
 *
 * ZWEI REGELN DURCHGEHEND:
 *
 *   1. GESPEICHERT WIRD DER HASH, nicht das Geheimnis. Weder ein
 *      Autorisierungscode noch ein Auffrischungstoken steht im Klartext in
 *      der Datenbank; ein Abzug enthaelt damit nichts Gueltiges.
 *   2. NICHTS DAVON WIRD GELOGGT. Kein Passwort, kein Token, kein Code —
 *      auch nicht in einem Fehlertext (harte Regel 2).
 */
import { anmeldungAbfragen, anmeldungTransaktion, type Abfrager } from './db'

/** SHA-256, hex. Fuer Codes und Tokens — sie sind zufaellig und lang, ein
 *  langsamer Passworthash waere hier Aufwand ohne Gewinn. */
export async function hash(wert: string): Promise<string> {
  const roh = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(wert))
  return [...new Uint8Array(roh)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export const zufall = (bytes = 32) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')

// --- Nutzer ----------------------------------------------------------

export type Nutzer = {
  subject: string
  email: string | null
  anzeige: string | null
  stufe: 'lesen' | 'fragen' | 'gesperrt'
  aktiv: boolean
  passwort_hash: string | null
  fehlversuche: number
  gesperrt_bis: string | null
}

export const nutzerNachEmail = async (email: string): Promise<Nutzer | null> =>
  (await anmeldungAbfragen<Nutzer>(
    `SELECT subject, email, anzeige, stufe, aktiv, passwort_hash, fehlversuche, gesperrt_bis
       FROM mcp.nutzer WHERE lower(email) = lower($1)`, [email]))[0] ?? null

export const nutzerNachSubject = async (subject: string): Promise<Nutzer | null> =>
  (await anmeldungAbfragen<Nutzer>(
    `SELECT subject, email, anzeige, stufe, aktiv, passwort_hash, fehlversuche, gesperrt_bis
       FROM mcp.nutzer WHERE subject = $1`, [subject]))[0] ?? null

/**
 * Wie lange nach wie vielen Fehlversuchen gesperrt wird.
 *
 * Harte Regel 7 sinngemaess: wiederholte Fehlanmeldungen werden gebremst,
 * nicht gezaehlt und durchgewinkt. Die Staffelung ist bewusst mild — drei
 * Nutzer, die ihr Passwort vertippen, sollen nicht ausgesperrt bleiben —
 * aber sie macht systematisches Durchprobieren sinnlos.
 */
export function sperrdauerSekunden(fehlversuche: number): number {
  if (fehlversuche < 5) return 0
  if (fehlversuche < 8) return 60
  if (fehlversuche < 12) return 15 * 60
  return 60 * 60
}

export async function fehlversuchMerken(subject: string): Promise<number> {
  // Erst hochzaehlen und den NEUEN Stand zurueckgeben, dann sperren. Die
  // Dauer haengt vom neuen Stand ab; sie im selben UPDATE zu raten hiesse,
  // sie einen Moment lang falsch stehen zu haben.
  const [n] = await anmeldungAbfragen<{ fehlversuche: number }>(
    `UPDATE mcp.nutzer SET fehlversuche = fehlversuche + 1
      WHERE subject = $1 RETURNING fehlversuche`, [subject])

  const dauer = sperrdauerSekunden(n?.fehlversuche ?? 0)
  if (dauer > 0) {
    await anmeldungAbfragen(
      `UPDATE mcp.nutzer SET gesperrt_bis = now() + make_interval(secs => $2::int)
        WHERE subject = $1`, [subject, dauer])
  }
  return dauer
}

export async function anmeldungGelungen(subject: string): Promise<void> {
  await anmeldungAbfragen(
    `UPDATE mcp.nutzer SET fehlversuche = 0, gesperrt_bis = NULL, letzter_login = now()
      WHERE subject = $1`, [subject])
}

export async function anmeldungProtokollieren(e: {
  email?: string | null; subject?: string | null; erfolg: boolean
  grund?: string | null; herkunft?: string | null
}): Promise<void> {
  await anmeldungAbfragen(
    `INSERT INTO mcp.anmeldung_protokoll (email, subject, erfolg, grund, herkunft)
     VALUES ($1,$2,$3,$4,$5)`,
    [e.email ?? null, e.subject ?? null, e.erfolg, e.grund ?? null, e.herkunft ?? null])
}

// --- Clients (Dynamic Client Registration) ---------------------------

export type Client = { client_id: string; client_name: string | null; redirect_uris: string[] }

export const clientHolen = async (id: string): Promise<Client | null> =>
  (await anmeldungAbfragen<Client>(
    `SELECT client_id, client_name, redirect_uris FROM mcp.oauth_client WHERE client_id = $1`,
    [id]))[0] ?? null

export async function clientAnlegen(name: string | null, redirectUris: string[]): Promise<Client> {
  const client_id = crypto.randomUUID()
  await anmeldungAbfragen(
    `INSERT INTO mcp.oauth_client (client_id, client_name, redirect_uris) VALUES ($1,$2,$3)`,
    [client_id, name, redirectUris])
  return { client_id, client_name: name, redirect_uris: redirectUris }
}

// --- Codes -----------------------------------------------------------

export async function codeAusstellen(o: {
  clientId: string; subject: string; redirectUri: string; codeChallenge: string
  scope?: string | null; resource?: string | null
}): Promise<string> {
  const code = zufall()
  await anmeldungAbfragen(
    `INSERT INTO mcp.oauth_code
       (code_hash, client_id, subject, redirect_uri, code_challenge, scope, resource, laeuft_ab)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '60 seconds')`,
    [await hash(code), o.clientId, o.subject, o.redirectUri, o.codeChallenge,
     o.scope ?? null, o.resource ?? null])
  return code
}

/**
 * Einen Code einloesen — genau einmal.
 *
 * Das `UPDATE ... WHERE eingeloest_am IS NULL ... RETURNING` ist der ganze
 * Schutz gegen doppelte Einloesung: Postgres entscheidet, wer zuerst war,
 * und der zweite bekommt keine Zeile. Eine Pruefung davor mit einem
 * `UPDATE` danach haette genau dazwischen ein Fenster.
 */
export async function codeEinloesen(code: string, clientId: string, redirectUri: string) {
  const [zeile] = await anmeldungAbfragen<{
    subject: string; code_challenge: string; scope: string | null; resource: string | null
  }>(
    `UPDATE mcp.oauth_code SET eingeloest_am = now()
      WHERE code_hash = $1 AND client_id = $2 AND redirect_uri = $3
        AND eingeloest_am IS NULL AND laeuft_ab > now()
      RETURNING subject, code_challenge, scope, resource`,
    [await hash(code), clientId, redirectUri])
  return zeile ?? null
}

// --- Auffrischungstokens ---------------------------------------------

/** Eine Kette = eine Verbindung (0139). `seit` ist die Anmeldung, die sie begann. */
export type Kette = { id: string; seit: string | Date }

export async function auffrischungAusstellen(
  clientId: string, subject: string, kette: Kette, tage = 30, q: Abfrager = anmeldungAbfragen,
): Promise<string> {
  const token = zufall(48)
  await q(
    `INSERT INTO mcp.oauth_token (token_hash, client_id, subject, laeuft_ab, kette_id, verbunden_seit)
     VALUES ($1,$2,$3, now() + make_interval(days => $4::int), $5, $6)`,
    [await hash(token), clientId, subject, tage, kette.id, kette.seit])
  return token
}

// --- Verbindungsgrenze (0139) ----------------------------------------

/**
 * Lebende Verbindungen eines Kontos und seine Grenze.
 *
 * JEDE LEBENDE KETTE ZAEHLT — auch eine, die seit Wochen niemand benutzt.
 * Entschieden am 28.10.2026: ein Platz wird nicht von selbst frei, sondern
 * von uns (`bun run nutzer trennen`). Wer ruhende Ketten nicht mitzaehlen
 * will, aendert es hier UND in mcp.verbindung_stand; die Abwaegung steht in
 * docs/entscheidungen.md.
 */
const LEBENDE_KETTEN = `SELECT count(*)::int AS n FROM mcp.oauth_token
  WHERE subject = $1 AND widerrufen_am IS NULL AND laeuft_ab > now()`

export async function verbindungenZaehlen(subject: string, q: Abfrager = anmeldungAbfragen) {
  const [n] = await q<{ grenze: number | null }>(
    `SELECT max_verbindungen AS grenze FROM mcp.nutzer WHERE subject = $1`, [subject])
  const [z] = await q<{ n: number }>(LEBENDE_KETTEN, [subject])
  return { grenze: n?.grenze ?? null, verbindungen: z?.n ?? 0 }
}

export const grenzeErreicht = (v: { grenze: number | null; verbindungen: number }) =>
  v.grenze !== null && v.verbindungen >= v.grenze

/**
 * Eine neue Verbindung beginnen — oder ablehnen, wenn die Grenze erreicht ist.
 *
 * Zaehlen und Ausstellen in einer Transaktion unter Sperre der Nutzerzeile.
 * Die Pruefung auf der Anmeldeseite davor ist nur fuer die verstaendliche
 * Meldung da; zwei gleichzeitige Anmeldungen kaemen dort beide durch. Hier
 * nicht.
 */
export async function verbindungEroeffnen(clientId: string, subject: string) {
  return anmeldungTransaktion(async q => {
    await q(`SELECT 1 FROM mcp.nutzer WHERE subject = $1 FOR UPDATE`, [subject])
    const v = await verbindungenZaehlen(subject, q)
    if (grenzeErreicht(v)) return { fehler: 'verbindungslimit' as const, ...v }
    const kette: Kette = { id: crypto.randomUUID(), seit: new Date() }
    const token = await auffrischungAusstellen(clientId, subject, kette, 30, q)
    return { token, kette: kette.id }
  })
}

/** Lebt die Verbindung noch? Gefragt bei JEDEM Werkzeugaufruf (src/auth.ts). */
export async function ketteLebt(kette: string): Promise<boolean> {
  const [z] = await anmeldungAbfragen<{ lebt: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM mcp.oauth_token
                     WHERE kette_id = $1 AND widerrufen_am IS NULL AND laeuft_ab > now()) AS lebt`,
    [kette])
  return Boolean(z?.lebt)
}

/**
 * Einloesen mit Rotation und Wiederverwendungserkennung.
 *
 * Taucht ein bereits eingeloester Token noch einmal auf, ist er
 * abhandengekommen — dann wird die ganze Kette dieses Nutzers widerrufen,
 * statt beide weiterlaufen zu lassen. Der Nutzer muss sich neu anmelden;
 * das ist der richtige Preis fuer einen Verdacht dieser Art.
 */
export async function auffrischungEinloesen(token: string, clientId: string) {
  const h = await hash(token)
  const [zeile] = await anmeldungAbfragen<{
    subject: string; widerrufen_am: string | null; laeuft_ab: string; ersetzt_durch: string | null
    kette_id: string | null; verbunden_seit: string | null
  }>(`SELECT subject, widerrufen_am, laeuft_ab, ersetzt_durch, kette_id, verbunden_seit
        FROM mcp.oauth_token WHERE token_hash = $1 AND client_id = $2`, [h, clientId])

  if (!zeile) return { fehler: 'unbekannt' as const }

  // Ketten von vor 0139 hat die Migration nachgetragen; fehlt die Kennung
  // trotzdem, bekommt die Kette hier eine — die Zaehlung aendert das nicht.
  const kette: Kette = {
    id: zeile.kette_id ?? crypto.randomUUID(),
    seit: zeile.verbunden_seit ?? new Date(),
  }

  if (zeile.widerrufen_am) {
    /**
     * GNADENFRIST, REVIEW 13.09.2026 — und ihre Grenze, gefunden im Test.
     *
     * Der gutartige Fall: die Tokenantwort ging in der Leitung verloren, der
     * Client hat den Nachfolger nie gesehen und legt den alten Token erneut
     * vor. Ihn dafuer mit Widerruf der ganzen Kette zu bestrafen hiesse: jede
     * Netzstoerung endet in einer Neuanmeldung.
     *
     * Woran man den gutartigen Fall ERKENNT: der alte Token wurde durch
     * Rotation ersetzt (ersetzt_durch gesetzt), und sein Nachfolger ist
     * noch unbenutzt (lebt). Haette der Client den Nachfolger erhalten,
     * haette er ihn benutzt. Dann — innerhalb von 60 s — wird der nie
     * zugestellte Nachfolger widerrufen und ein frischer ausgestellt.
     *
     * ALLES ANDERE IST EIN KONFLIKT: ein Token, der ohne Nachfolger
     * widerrufen wurde (Diebstahlserkennung, Stilllegung), oder dessen
     * Nachfolger schon benutzt ist, oder der aelter als 60 s ist. Dann faellt
     * die Familie. Die erste Fassung der Frist liess JEDEN kuerzlich
     * widerrufenen Token wiederholen — und damit haette ein Dieb mit einem
     * Geschwistertoken die Diebstahlserkennung selbst wieder aufgehoben.
     */
    const seitWiderruf = Date.now() - new Date(zeile.widerrufen_am).getTime()
    if (zeile.ersetzt_durch && seitWiderruf < 60_000) {
      const [nachfolger] = await anmeldungAbfragen<{ lebt: boolean }>(
        `SELECT widerrufen_am IS NULL AS lebt FROM mcp.oauth_token WHERE token_hash = $1`,
        [zeile.ersetzt_durch])
      if (nachfolger?.lebt) {
        // Nie zugestellt: bare widerrufen, OHNE Nachfolger — damit er selbst
        // keine Wiederholung mehr ausloesen kann. Den frischen ERST
        // ausstellen: dazwischen haette die Kette keinen lebenden Token, und
        // ketteLebt() wiese das noch gueltige Zugangstoken ab.
        const neu = await auffrischungAusstellen(clientId, zeile.subject, kette)
        await anmeldungAbfragen(
          `UPDATE mcp.oauth_token SET widerrufen_am = now() WHERE token_hash = $1`,
          [zeile.ersetzt_durch])
        await anmeldungAbfragen(
          `UPDATE mcp.oauth_token SET ersetzt_durch = $2 WHERE token_hash = $1`, [h, await hash(neu)])
        return { subject: zeile.subject, neu, kette: kette.id }
      }
    }
    await anmeldungAbfragen(
      `UPDATE mcp.oauth_token SET widerrufen_am = now()
        WHERE subject = $1 AND widerrufen_am IS NULL`, [zeile.subject])
    return { fehler: 'wiederverwendet' as const, subject: zeile.subject }
  }
  if (new Date(zeile.laeuft_ab) < new Date()) return { fehler: 'abgelaufen' as const }

  const neu = await auffrischungAusstellen(clientId, zeile.subject, kette)
  await anmeldungAbfragen(
    `UPDATE mcp.oauth_token SET widerrufen_am = now(), ersetzt_durch = $2 WHERE token_hash = $1`,
    [h, await hash(neu)])
  return { subject: zeile.subject, neu, kette: kette.id }
}

export async function tokensWiderrufen(subject: string): Promise<void> {
  await anmeldungAbfragen(
    `UPDATE mcp.oauth_token SET widerrufen_am = now()
      WHERE subject = $1 AND widerrufen_am IS NULL`, [subject])
}
