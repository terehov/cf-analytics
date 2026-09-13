/**
 * Der Signierschluessel und die Tokens.
 *
 * RS256 statt HS256: der Ressourcenteil des Servers prueft Tokens mit dem
 * OEFFENTLICHEN Schluessel. Mit einem gemeinsamen Geheimnis koennte jeder,
 * der pruefen darf, auch ausstellen — und genau diese Trennung ist der Punkt
 * der zweiten Rolle. Ein asymmetrisches Verfahren haelt sie auch dann, wenn
 * beide Teile im selben Prozess laufen.
 *
 * Der Schluessel liegt in der Datenbank, nicht in einer Umgebungsvariablen:
 * ein Neustart soll nicht jedes ausgegebene Token entwerten, und eine
 * Rotation soll kein Deploy brauchen.
 */
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK } from 'jose'
import { anmeldungAbfragen } from './db'

export const ALGORITHMUS = 'RS256'

type Schluessel = { kid: string; privat: CryptoKey; oeffentlich: JWK }

let geladen: Schluessel | null = null

/**
 * Den aktiven Schluessel holen — beim ersten Start erzeugen.
 *
 * `ON CONFLICT DO NOTHING` statt einer Pruefung davor: starten zwei
 * Instanzen gleichzeitig, erzeugen beide ein Paar, und genau eine gewinnt.
 * Ohne das bekaemen beide ihr eigenes, und Tokens der einen waeren fuer die
 * andere ungueltig — ein Fehler, der sich als „manchmal muss man sich neu
 * anmelden" aeussert und darum ewig ungeklaert bliebe.
 */
export async function schluesselHolen(): Promise<Schluessel> {
  if (geladen) return geladen

  const [vorhanden] = await anmeldungAbfragen<{ kid: string; privat_jwk: JWK; oeffentlich_jwk: JWK }>(
    `SELECT kid, privat_jwk, oeffentlich_jwk FROM mcp.oauth_schluessel
      WHERE aktiv ORDER BY angelegt_am DESC LIMIT 1`)

  if (vorhanden) {
    geladen = {
      kid: vorhanden.kid,
      privat: await importJWK(vorhanden.privat_jwk, ALGORITHMUS) as CryptoKey,
      oeffentlich: vorhanden.oeffentlich_jwk,
    }
    return geladen
  }

  const { privateKey, publicKey } = await generateKeyPair(ALGORITHMUS, { extractable: true })
  const kid = crypto.randomUUID()
  const privat = await exportJWK(privateKey)
  const oeffentlich = { ...await exportJWK(publicKey), kid, alg: ALGORITHMUS, use: 'sig' }

  await anmeldungAbfragen(
    `INSERT INTO mcp.oauth_schluessel (kid, privat_jwk, oeffentlich_jwk)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [kid, JSON.stringify({ ...privat, kid, alg: ALGORITHMUS }), JSON.stringify(oeffentlich)])

  geladen = null
  return schluesselHolen()
}

export async function jwks(): Promise<{ keys: JWK[] }> {
  const zeilen = await anmeldungAbfragen<{ oeffentlich_jwk: JWK }>(
    `SELECT oeffentlich_jwk FROM mcp.oauth_schluessel ORDER BY angelegt_am DESC`)
  return { keys: zeilen.map(z => z.oeffentlich_jwk) }
}

/** Ein Zugangstoken ausstellen. */
export async function zugangstokenAusstellen(o: {
  subject: string; clientId: string; stufe: string; anzeige: string | null
  aussteller: string; publikum: string; gueltigSekunden: number
}): Promise<string> {
  const k = await schluesselHolen()
  return new SignJWT({ stufe: o.stufe, name: o.anzeige ?? undefined, client_id: o.clientId })
    .setProtectedHeader({ alg: ALGORITHMUS, kid: k.kid })
    .setIssuer(o.aussteller)
    .setAudience(o.publikum)
    .setSubject(o.subject)
    .setIssuedAt()
    .setExpirationTime(`${o.gueltigSekunden}s`)
    .sign(k.privat)
}

/**
 * Ein kurzlebiges Token fuer das Anmeldeformular.
 *
 * Es traegt die Anfrage selbst — Client, Rueckadresse, PKCE-Pruefwert — und
 * ist signiert. Damit braucht das Formular KEINE Sitzung auf dem Server und
 * laesst sich nicht manipulieren: wer die Rueckadresse im versteckten Feld
 * aendert, macht die Signatur ungueltig. Das ist zugleich der Schutz gegen
 * untergeschobene Formulare (CSRF).
 */
export async function formulartokenAusstellen(
  daten: Record<string, string | undefined>, aussteller: string,
): Promise<string> {
  const k = await schluesselHolen()
  return new SignJWT(daten as Record<string, string>)
    .setProtectedHeader({ alg: ALGORITHMUS, kid: k.kid })
    .setIssuer(aussteller)
    .setAudience('anmeldeformular')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(k.privat)
}

export async function formulartokenPruefen(
  token: string, aussteller: string,
): Promise<Record<string, string>> {
  const k = await schluesselHolen()
  const oeffentlich = await importJWK(k.oeffentlich, ALGORITHMUS)
  const { payload } = await jwtVerify(token, oeffentlich, {
    issuer: aussteller, audience: 'anmeldeformular',
  })
  return payload as Record<string, string>
}

/** Tokens pruefen — fuer den Ressourcenteil des Servers. */
export async function zugangstokenPruefen(
  token: string, aussteller: string, publikum: string,
) {
  const k = await schluesselHolen()
  const oeffentlich = await importJWK(k.oeffentlich, ALGORITHMUS)
  return jwtVerify(token, oeffentlich, { issuer: aussteller, audience: publikum })
}
