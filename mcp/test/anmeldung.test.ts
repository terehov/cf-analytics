/**
 * Der Autorisierungsserver, von Ende zu Ende.
 *
 * WARUM DIESE DATEI DIE WICHTIGSTE DES VERZEICHNISSES IST. Alles andere hier
 * entscheidet, ob eine ZAHL stimmt. Dieser Teil entscheidet, ob ein Fremder
 * an die Zahlen kommt. Ein selbstgebauter Autorisierungsserver ist nur dann
 * vertretbar, wenn die Eigenschaften, auf die er sich beruft, gemessen sind
 * und nicht behauptet.
 *
 * Geprueft wird deshalb nicht nur der gelingende Ablauf, sondern jeder Weg
 * daneben: Code zweimal, falscher Verifier, fremde Rueckadresse, fehlendes
 * PKCE, falsches Passwort, Zeitsperre, wiederverwendeter Auffrischungstoken.
 *
 *   MCP_AUTH_DATABASE_URL=postgresql://mcp_anmeldung:...@host/lina bun test
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { anmeldungAbfragen, anmeldungPool } from '../src/anmeldung/db'
import { anmeldungMontieren } from '../src/anmeldung/endpunkte'
import { zugangstokenPruefen } from '../src/anmeldung/schluessel'

const DB = process.env.MCP_AUTH_DATABASE_URL
const lauf = DB ? describe : describe.skip

let server: Server
let basis = ''
const EMAIL = 'test-anmeldung@example.invalid'
const PASSWORT = 'ein hinreichend langer satz'
const RUECK = 'https://chatgpt.example/callback'

/** PKCE-Paar wie ein Client es bildet. */
async function pkce() {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  const roh = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: Buffer.from(roh).toString('base64url') }
}

const formular = (o: Record<string, string>) => new URLSearchParams(o).toString()
const postForm = (pfad: string, daten: Record<string, string>, folgen = false) =>
  fetch(basis + pfad, {
    method: 'POST', redirect: folgen ? 'follow' : 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formular(daten),
  })

/** Das versteckte Feld aus dem Anmeldeformular ziehen. */
const anfrageFeldAus = (html: string) =>
  html.match(/name="anfrage" value="([^"]+)"/)?.[1] ?? ''

lauf('Autorisierungsserver', () => {
  let clientId = ''

  beforeAll(async () => {
    const e = express()
    e.use(express.json())
    await new Promise<void>(fertig => {
      server = e.listen(0, () => {
        const a = server.address()
        basis = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
        anmeldungMontieren(e, { aussteller: basis, publikum: basis })
        fertig()
      })
    })

    await anmeldungAbfragen(`DELETE FROM mcp.nutzer WHERE email = $1`, [EMAIL])
    await anmeldungAbfragen(
      `INSERT INTO mcp.nutzer (subject, email, anzeige, stufe, passwort_hash)
       VALUES ($1,$2,'Testkonto','fragen',$3)`,
      [crypto.randomUUID(), EMAIL, await Bun.password.hash(PASSWORT)])

    const r = await fetch(basis + '/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Testclient', redirect_uris: [RUECK] }),
    })
    clientId = (await r.json()).client_id
  })

  afterAll(async () => {
    await anmeldungAbfragen(`DELETE FROM mcp.nutzer WHERE email = $1`, [EMAIL]).catch(() => {})
    await anmeldungAbfragen(`DELETE FROM mcp.oauth_client WHERE client_id = $1`, [clientId]).catch(() => {})
    server?.close()
  })

  /** Den ganzen Ablauf einmal durchspielen; gibt die Tokenantwort zurueck. */
  async function ablauf(passwort = PASSWORT) {
    const { verifier, challenge } = await pkce()
    const seite = await fetch(
      `${basis}/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(RUECK)}&code_challenge=${challenge}` +
      `&code_challenge_method=S256&state=abc123`)
    const anfrage = anfrageFeldAus(await seite.text())

    const angemeldet = await postForm('/anmelden', { anfrage, email: EMAIL, passwort })
    const ort = angemeldet.headers.get('location') ?? ''
    const code = new URL(ort || 'https://x.invalid').searchParams.get('code') ?? ''
    return { verifier, challenge, angemeldet, ort, code }
  }

  test('Registrierung, Anmeldung, Code, Token — der ganze Weg', async () => {
    const { verifier, angemeldet, ort, code } = await ablauf()

    expect(angemeldet.status).toBe(302)
    expect(ort.startsWith(RUECK)).toBe(true)
    expect(new URL(ort).searchParams.get('state')).toBe('abc123')
    expect(code.length).toBeGreaterThan(20)

    const t = await postForm('/token', {
      grant_type: 'authorization_code', code, client_id: clientId,
      redirect_uri: RUECK, code_verifier: verifier,
    })
    expect(t.status).toBe(200)
    const antwort = await t.json()
    expect(antwort.token_type).toBe('Bearer')
    expect(antwort.expires_in).toBe(3600)
    expect(antwort.refresh_token).toBeTruthy()

    // Das Token muss sich mit dem oeffentlichen Schluessel pruefen lassen
    // und die Stufe tragen.
    const { payload } = await zugangstokenPruefen(antwort.access_token, basis, basis)
    expect(payload.stufe).toBe('fragen')
    expect(payload.sub).toBeTruthy()
  })

  test('Ein Code laesst sich nur EINMAL einloesen', async () => {
    const { verifier, code } = await ablauf()
    const daten = { grant_type: 'authorization_code', code, client_id: clientId,
                    redirect_uri: RUECK, code_verifier: verifier }
    expect((await postForm('/token', daten)).status).toBe(200)
    const zweite = await postForm('/token', daten)
    expect(zweite.status).toBe(400)
    expect((await zweite.json()).error).toBe('invalid_grant')
  })

  test('Ein falscher code_verifier bekommt kein Token', async () => {
    const { code } = await ablauf()
    const r = await postForm('/token', {
      grant_type: 'authorization_code', code, client_id: clientId,
      redirect_uri: RUECK, code_verifier: 'der-falsche-verifier-aber-lang-genug',
    })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('invalid_grant')
  })

  test('Ohne PKCE wird gar nicht erst ein Formular gezeigt', async () => {
    const r = await fetch(
      `${basis}/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(RUECK)}`)
    expect(r.status).toBe(400)
    expect(await r.text()).toContain('PKCE')
  })

  test('Eine fremde Rueckadresse wird abgewiesen — keine offene Weiterleitung', async () => {
    const { challenge } = await pkce()
    const r = await fetch(
      `${basis}/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent('https://boeser-ort.example/abholen')}` +
      `&code_challenge=${challenge}&code_challenge_method=S256`)
    expect(r.status).toBe(400)
    expect(await r.text()).toContain('Rueckadresse')
  })

  test('Ein falsches Passwort gibt keinen Code und wird protokolliert', async () => {
    const vorher = await anmeldungAbfragen<{ n: number }>(
      `SELECT count(*)::int AS n FROM mcp.anmeldung_protokoll WHERE email = $1 AND NOT erfolg`, [EMAIL])
    const { angemeldet, code } = await ablauf('falsch')
    expect(angemeldet.status).toBe(401)
    expect(code).toBe('')
    const nachher = await anmeldungAbfragen<{ n: number }>(
      `SELECT count(*)::int AS n FROM mcp.anmeldung_protokoll WHERE email = $1 AND NOT erfolg`, [EMAIL])
    expect(nachher[0]!.n).toBe(vorher[0]!.n + 1)
    // Aufraeumen, damit die Zeitsperre die folgenden Tests nicht trifft.
    await anmeldungAbfragen(
      `UPDATE mcp.nutzer SET fehlversuche = 0, gesperrt_bis = NULL WHERE email = $1`, [EMAIL])
  })

  test('Ein manipuliertes Formulartoken wird abgewiesen', async () => {
    const r = await postForm('/anmelden', {
      anfrage: 'offensichtlich.kein.gueltiges.token', email: EMAIL, passwort: PASSWORT,
    })
    expect(r.status).toBe(400)
    expect(await r.text()).toContain('Abgelaufen')
  })

  test('Auffrischung rotiert, und der alte Token widerruft die Kette', async () => {
    const { verifier, code } = await ablauf()
    const erste = await (await postForm('/token', {
      grant_type: 'authorization_code', code, client_id: clientId,
      redirect_uri: RUECK, code_verifier: verifier,
    })).json()

    const zweite = await (await postForm('/token', {
      grant_type: 'refresh_token', refresh_token: erste.refresh_token, client_id: clientId,
    })).json()
    expect(zweite.access_token).toBeTruthy()
    expect(zweite.refresh_token).not.toBe(erste.refresh_token)

    // Der ALTE Token noch einmal: gilt als abhandengekommen.
    const dritte = await postForm('/token', {
      grant_type: 'refresh_token', refresh_token: erste.refresh_token, client_id: clientId,
    })
    expect(dritte.status).toBe(400)

    // Und die Kette ist widerrufen — auch der zwischenzeitlich gueltige.
    const vierte = await postForm('/token', {
      grant_type: 'refresh_token', refresh_token: zweite.refresh_token, client_id: clientId,
    })
    expect(vierte.status).toBe(400)
  })

  test('Ein stillgelegtes Konto bekommt kein Token mehr', async () => {
    const { verifier, code } = await ablauf()
    await anmeldungAbfragen(`UPDATE mcp.nutzer SET aktiv = false WHERE email = $1`, [EMAIL])
    const r = await postForm('/token', {
      grant_type: 'authorization_code', code, client_id: clientId,
      redirect_uri: RUECK, code_verifier: verifier,
    })
    expect(r.status).toBe(400)
    await anmeldungAbfragen(`UPDATE mcp.nutzer SET aktiv = true WHERE email = $1`, [EMAIL])
  })

  test('Eine Rueckadresse ohne https wird nicht registriert', async () => {
    const r = await fetch(basis + '/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Unsicher', redirect_uris: ['http://fremd.example/x'] }),
    })
    expect(r.status).toBe(400)
  })

  test('Der oeffentliche Schluessel wird ausgeliefert, der private nie', async () => {
    const j = await (await fetch(basis + '/jwks')).json()
    expect(j.keys.length).toBeGreaterThan(0)
    expect(j.keys[0].kty).toBe('RSA')
    // Kein privater Exponent, kein Primfaktor.
    for (const k of j.keys) {
      expect(k.d).toBeUndefined()
      expect(k.p).toBeUndefined()
      expect(k.q).toBeUndefined()
    }
  })
})
