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
import { anmeldungAbfragen } from './db'

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

export async function auffrischungAusstellen(
  clientId: string, subject: string, tage = 30,
): Promise<string> {
  const token = zufall(48)
  await anmeldungAbfragen(
    `INSERT INTO mcp.oauth_token (token_hash, client_id, subject, laeuft_ab)
     VALUES ($1,$2,$3, now() + make_interval(days => $4::int))`,
    [await hash(token), clientId, subject, tage])
  return token
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
    subject: string; widerrufen_am: string | null; laeuft_ab: string
  }>(`SELECT subject, widerrufen_am, laeuft_ab FROM mcp.oauth_token
        WHERE token_hash = $1 AND client_id = $2`, [h, clientId])

  if (!zeile) return { fehler: 'unbekannt' as const }

  if (zeile.widerrufen_am) {
    await anmeldungAbfragen(
      `UPDATE mcp.oauth_token SET widerrufen_am = now()
        WHERE subject = $1 AND widerrufen_am IS NULL`, [zeile.subject])
    return { fehler: 'wiederverwendet' as const, subject: zeile.subject }
  }
  if (new Date(zeile.laeuft_ab) < new Date()) return { fehler: 'abgelaufen' as const }

  const neu = await auffrischungAusstellen(clientId, zeile.subject)
  await anmeldungAbfragen(
    `UPDATE mcp.oauth_token SET widerrufen_am = now(), ersetzt_durch = $2 WHERE token_hash = $1`,
    [h, await hash(neu)])
  return { subject: zeile.subject, neu }
}

export async function tokensWiderrufen(subject: string): Promise<void> {
  await anmeldungAbfragen(
    `UPDATE mcp.oauth_token SET widerrufen_am = now()
      WHERE subject = $1 AND widerrufen_am IS NULL`, [subject])
}
