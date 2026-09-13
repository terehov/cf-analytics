/**
 * Nutzer anlegen, aendern, stilllegen.
 *
 *   bun run nutzer anlegen  daniel@brain.food "Daniel" lesen
 *   bun run nutzer passwort daniel@brain.food
 *   bun run nutzer stufe    daniel@brain.food fragen
 *   bun run nutzer sperren  daniel@brain.food
 *   bun run nutzer liste
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

  case 'liste': {
    const zeilen = await anmeldungAbfragen(
      `SELECT email, anzeige, stufe, aktiv, letzter_login, fehlversuche, gesperrt_bis
         FROM mcp.nutzer ORDER BY email`)
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

Das Passwort wird abgefragt, nie als Argument uebergeben.`)
}

await anmeldungPool.end()
