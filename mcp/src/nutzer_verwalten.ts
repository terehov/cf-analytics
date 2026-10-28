/**
 * Nutzer anlegen, aendern, stilllegen.
 *
 *   bun run nutzer anlegen  daniel@brain.food "Daniel" lesen
 *   bun run nutzer passwort daniel@brain.food
 *   bun run nutzer stufe    daniel@brain.food fragen
 *   bun run nutzer sperren  daniel@brain.food
 *   bun run nutzer liste
 *   bun run nutzer limit        daniel@brain.food 2      (oder: aus)
 *   bun run nutzer verbindungen daniel@brain.food
 *   bun run nutzer trennen      daniel@brain.food 3f2a9c1e   (oder: alle)
 *
 * DIE VERBINDUNGSGRENZE (0139) LEHNT AB, sie verdraengt nicht. Ein Platz
 * wird nur frei, wenn eine Verbindung ablaeuft oder hier getrennt wird —
 * das ist die Freigabe durch uns. Getrennt heisst sofort: auch das noch
 * laufende Zugangstoken der Verbindung gilt ab dem naechsten Aufruf nicht
 * mehr (src/auth.ts).
 *
 * DAS PASSWORT WIRD NIE ALS ARGUMENT ENTGEGENGENOMMEN. Ein Argument steht
 * in der Prozessliste und in der Shell-Historie; beides ueberlebt den
 * Befehl. Es wird abgefragt, ohne Echo, und geht als argon2id-Hash in die
 * Datenbank (harte Regel 2).
 */
import { anmeldungAbfragen, anmeldungEingerichtet, anmeldungPool } from './anmeldung/db'
import { tokensWiderrufen } from './anmeldung/speicher'

if (!anmeldungEingerichtet()) {
  console.error('MCP_AUTH_DATABASE_URL fehlt — ohne die Anmelderolle geht das nicht.')
  process.exit(1)
}

const [befehl, ...argumente] = process.argv.slice(2)

/** Ohne Echo einlesen. Zweimal, damit ein Tippfehler nicht zur Aussperrung wird. */
async function passwortFragen(): Promise<string> {
  const lesen = async (frage: string): Promise<string> => {
    process.stdout.write(frage)
    const tty = Bun.file('/dev/tty')
    // Rohmodus ueber stty: bun hat keinen eigenen Weg, das Echo abzuschalten.
    await Bun.$`stty -echo < /dev/tty`.quiet()
    try {
      const strom = tty.stream().getReader()
      let gesammelt = ''
      while (!gesammelt.includes('\n')) {
        const { value, done } = await strom.read()
        if (done) break
        gesammelt += new TextDecoder().decode(value)
      }
      await strom.cancel()
      return gesammelt.split('\n')[0]!
    } finally {
      await Bun.$`stty echo < /dev/tty`.quiet()
      process.stdout.write('\n')
    }
  }
  const a = await lesen('Passwort: ')
  const b = await lesen('Noch einmal: ')
  if (a !== b) { console.error('Die beiden Eingaben sind nicht gleich.'); process.exit(1) }
  if (a.length < 12) {
    // Keine Sonderzeichenregel, sondern Laenge: sie ist das Einzige, was
    // messbar hilft, und drei Menschen koennen sich einen Satz merken.
    console.error('Mindestens 12 Zeichen. Ein Satz ist leichter zu merken als ein Kauderwelsch.')
    process.exit(1)
  }
  return a
}

const stufen = new Set(['lesen', 'fragen', 'gesperrt'])

switch (befehl) {
  case 'anlegen': {
    const [email, anzeige, stufe = 'lesen'] = argumente
    if (!email || !anzeige) { console.error('bun run nutzer anlegen <email> "<name>" [stufe]'); process.exit(1) }
    if (!stufen.has(stufe)) { console.error(`Stufe muss lesen, fragen oder gesperrt sein.`); process.exit(1) }
    const passwort = await passwortFragen()
    const subject = crypto.randomUUID()
    await anmeldungAbfragen(
      `INSERT INTO mcp.nutzer (subject, email, anzeige, stufe, passwort_hash)
       VALUES ($1,$2,$3,$4,$5)`,
      [subject, email, anzeige, stufe, await Bun.password.hash(passwort)])
    console.log(`Angelegt: ${anzeige} <${email}>, Stufe ${stufe}`)
    break
  }

  case 'passwort': {
    const [email] = argumente
    if (!email) { console.error('bun run nutzer passwort <email>'); process.exit(1) }
    const passwort = await passwortFragen()
    const geaendert = await anmeldungAbfragen(
      `UPDATE mcp.nutzer SET passwort_hash = $2, fehlversuche = 0, gesperrt_bis = NULL
        WHERE lower(email) = lower($1) RETURNING subject`,
      [email, await Bun.password.hash(passwort)])
    if (!geaendert.length) { console.error('Kein Konto mit dieser Adresse.'); process.exit(1) }
    // Ein neues Passwort beendet die alten Sitzungen — sonst liefe ein
    // abhandengekommener Auffrischungstoken weiter, und genau deshalb
    // aendert man es ja.
    await tokensWiderrufen(geaendert[0].subject)
    console.log('Passwort geaendert, bestehende Tokens widerrufen.')
    break
  }

  case 'stufe': {
    const [email, stufe] = argumente
    if (!email || !stufe || !stufen.has(stufe)) {
      console.error('bun run nutzer stufe <email> <lesen|fragen|gesperrt>'); process.exit(1)
    }
    const r = await anmeldungAbfragen(
      `UPDATE mcp.nutzer SET stufe = $2 WHERE lower(email) = lower($1) RETURNING subject`,
      [email, stufe])
    if (!r.length) { console.error('Kein Konto mit dieser Adresse.'); process.exit(1) }
    console.log(`Stufe auf ${stufe} gesetzt — wirkt sofort, nicht erst beim naechsten Token.`)
    break
  }

  case 'sperren': {
    const [email] = argumente
    if (!email) { console.error('bun run nutzer sperren <email>'); process.exit(1) }
    const r = await anmeldungAbfragen(
      `UPDATE mcp.nutzer SET aktiv = false WHERE lower(email) = lower($1) RETURNING subject`,
      [email])
    if (!r.length) { console.error('Kein Konto mit dieser Adresse.'); process.exit(1) }
    await tokensWiderrufen(r[0].subject)
    console.log('Stillgelegt und alle Tokens widerrufen.')
    break
  }

  case 'limit': {
    const [email, wert] = argumente
    const grenze = wert === 'aus' ? null : Number(wert)
    if (!email || (grenze !== null && !(Number.isInteger(grenze) && grenze >= 1))) {
      console.error('bun run nutzer limit <email> <anzahl ab 1|aus>'); process.exit(1)
    }
    const r = await anmeldungAbfragen<{ subject: string }>(
      `UPDATE mcp.nutzer SET max_verbindungen = $2 WHERE lower(email) = lower($1) RETURNING subject`,
      [email, grenze])
    if (!r.length) { console.error('Kein Konto mit dieser Adresse.'); process.exit(1) }
    const [z] = await anmeldungAbfragen<{ n: number }>(
      `SELECT count(*)::int AS n FROM mcp.oauth_token
        WHERE subject = $1 AND widerrufen_am IS NULL AND laeuft_ab > now()`, [r[0]!.subject])
    console.log(grenze === null
      ? 'Keine Verbindungsgrenze mehr.'
      : `Grenze ${grenze}, verbunden ${z!.n}.`)
    // Bestehende Verbindungen ueber der neuen Grenze bleiben stehen — sie zu
    // kappen ist eine eigene Entscheidung, also ein eigener Befehl.
    if (grenze !== null && z!.n > grenze) {
      console.log(`Es bestehen mehr Verbindungen als erlaubt. Neue werden abgelehnt; die ` +
        `bestehenden zeigt \`bun run nutzer verbindungen ${email}\`, \`trennen\` beendet sie.`)
    }
    break
  }

  case 'verbindungen': {
    const [email] = argumente
    if (!email) { console.error('bun run nutzer verbindungen <email>'); process.exit(1) }
    const zeilen = await anmeldungAbfragen(
      `SELECT left(t.kette_id::text, 8) AS kette, c.client_name AS client,
              t.verbunden_seit, t.angelegt_am AS zuletzt_aufgefrischt, t.laeuft_ab
         FROM mcp.oauth_token t
         JOIN mcp.nutzer n ON n.subject = t.subject
         LEFT JOIN mcp.oauth_client c ON c.client_id = t.client_id
        WHERE lower(n.email) = lower($1) AND t.widerrufen_am IS NULL AND t.laeuft_ab > now()
        ORDER BY t.verbunden_seit`, [email])
    if (!zeilen.length) { console.log('Keine lebende Verbindung.'); break }
    console.table(zeilen)
    break
  }

  case 'trennen': {
    const [email, kette] = argumente
    // Mindestens die acht Zeichen, die `verbindungen` zeigt — ein kuerzerer
    // Anfang traefe womoeglich mehr als die gemeinte Verbindung.
    if (!email || !kette || (kette !== 'alle' && kette.length < 8)) {
      console.error('bun run nutzer trennen <email> <kette (8 Zeichen aus verbindungen)|alle>'); process.exit(1)
    }
    const r = await anmeldungAbfragen(
      `UPDATE mcp.oauth_token t SET widerrufen_am = now()
         FROM mcp.nutzer n
        WHERE n.subject = t.subject AND lower(n.email) = lower($1)
          AND t.widerrufen_am IS NULL
          AND ($2 = 'alle' OR t.kette_id::text LIKE $2 || '%')
        RETURNING t.kette_id`, [email, kette])
    const ketten = new Set(r.map((z: any) => z.kette_id))
    console.log(ketten.size
      ? `${ketten.size} Verbindung(en) getrennt — wirkt sofort.`
      : 'Keine passende lebende Verbindung.')
    break
  }

  case 'liste': {
    const zeilen = await anmeldungAbfragen(
      `SELECT email, anzeige, stufe, aktiv, letzter_login, fehlversuche, gesperrt_bis,
              max_verbindungen,
              (SELECT count(*)::int FROM mcp.oauth_token t
                WHERE t.subject = n.subject AND t.widerrufen_am IS NULL AND t.laeuft_ab > now())
                AS verbindungen
         FROM mcp.nutzer n ORDER BY email`)
    if (!zeilen.length) { console.log('Noch kein Konto angelegt.'); break }
    console.table(zeilen)
    break
  }

  default:
    console.log(`Nutzer des MCP-Zugangs verwalten.

  bun run nutzer anlegen  <email> "<name>" [lesen|fragen]
  bun run nutzer passwort <email>
  bun run nutzer stufe    <email> <lesen|fragen|gesperrt>
  bun run nutzer sperren  <email>
  bun run nutzer liste
  bun run nutzer limit        <email> <anzahl|aus>
  bun run nutzer verbindungen <email>
  bun run nutzer trennen      <email> <kette|alle>

Die Verbindungsgrenze lehnt neue Anmeldungen ab, sobald sie erreicht ist.
Frei wird ein Platz nur durch Ablauf oder trennen.

Das Passwort wird abgefragt, nie als Argument uebergeben.`)
}

await anmeldungPool.end()
