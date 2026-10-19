/**
 * Der Katalog wird im laufenden Betrieb nachgeladen — und nur, wenn er
 * vollstaendig bewacht ist.
 *
 * BEFUND 19.10.2026: Migration 0132 legte vier Rezeptur-Sichten an, der
 * laufende Server kannte sie nicht. Er war beim Deploy VOR der Migration im
 * Importer-Container oben und hielt den Katalog vom Start bis zum naechsten
 * Neustart. Claude sagte Nutzern, es gebe keine Rezeptdaten.
 *
 * Erster Teil ohne Datenbank, mit einer Attrappe als Quelle — er laeuft bei
 * jedem `bun test`. Der zweite Teil laeuft gegen einen LOKALEN KLON und
 * braucht zwei Variablen:
 *
 *   MCP_DATABASE_URL=postgresql://mcp_leser:…@localhost/lina_mcp_…   (liest, wie der Server)
 *   MCP_TEST_SCHREIB_URL=postgresql://localhost/lina_mcp_…            (aendert den Katalog)
 *
 * Die Schreib-Adresse wird geprueft: nur localhost und nur ein Klon
 * (`lina_mcp_…`, `…_test…`, `…_klon…`). Gegen Produktion schreibt dieser Test
 * nicht — auch nicht ueber einen SSH-Tunnel auf localhost, dafuer der Name.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import pg from 'pg'
import type { Fallstrick, Sicht } from '../src/katalog'
import type { KatalogRoh } from '../src/katalog_laden'
import {
  FEHLTREFFER_ABSTAND_MS, STILLSTAND_MS, aktuellerKatalog, katalogBeobachten, katalogErstladen,
  katalogFehltreffer, katalogFuer, katalogNachladen, katalogStoerung, katalogZuruecksetzen,
  katalogZustand, type Katalogquelle,
} from '../src/katalog_nachladen'
import abzug from './katalog.json'

const ALT = abzug as unknown as KatalogRoh

const REZEPT: Sicht = {
  sicht: 'mart.zz_rezept_probe', koernung: 'Rezept, Zutat und Ebene', thema: 'einkauf',
  summen_erlaubt: false, kommentar: 'In welchen Rezepten steckt Nummer X?',
  spalten: ['marke', 'rezept', 'artikelnummer', 'ebene'], achsen: [], kennzahlen: [],
}

const UNBEKANNT: Fallstrick = {
  schluessel: 'probe_unbekannte_regelart', art: 'gibt_es_nicht', schwere: 'sperre', sicht: null,
  parameter: {}, hinweis: 'Probe', berichtigung: null, quelle: null,
}

/** Eine Quelle, deren Stand der Test von Hand weiterdreht. */
function attrappe(start: KatalogRoh) {
  let stand = start
  let version = 0
  const zaehler = { fingerabdruck: 0, laden: 0 }
  let kaputt = false
  const quelle: Katalogquelle = {
    fingerabdruck: async () => {
      zaehler.fingerabdruck++
      if (kaputt) throw new Error('Verbindung weg')
      return `v${version}`
    },
    laden: async () => { zaehler.laden++; return stand },
  }
  return {
    quelle, zaehler,
    setzen(neu: KatalogRoh) { stand = neu; version++ },
    kaputtMachen(ja: boolean) { kaputt = ja },
  }
}

const mitRezept = (roh: KatalogRoh): KatalogRoh => ({ ...roh, sichten: [...roh.sichten, REZEPT] })
const mitUnbekannterRegel = (roh: KatalogRoh): KatalogRoh =>
  ({ ...roh, fallstricke: [...roh.fallstricke, UNBEKANNT] })

/** Logzeilen mitlesen, ohne die Testausgabe zu fluten. */
function logMitlesen() {
  const zeilen: any[] = []
  const fang = (...a: unknown[]) => { try { zeilen.push(JSON.parse(String(a[0]))) } catch {} }
  const spione = [spyOn(console, 'log').mockImplementation(fang),
                  spyOn(console, 'warn').mockImplementation(fang),
                  spyOn(console, 'error').mockImplementation(fang)]
  return { zeilen, aus: () => spione.forEach(s => s.mockRestore()) }
}

describe('Katalog nachladen (ohne Datenbank)', () => {
  let log: ReturnType<typeof logMitlesen>
  beforeEach(() => { log = logMitlesen() })
  afterEach(() => { log.aus(); katalogZuruecksetzen() })

  test('eine Katalogaenderung wird ohne Neustart uebernommen — und geloggt', async () => {
    const q = attrappe(ALT)
    katalogZuruecksetzen(q.quelle)
    await katalogErstladen()
    const vorher = aktuellerKatalog()
    expect(vorher.sichten.has(REZEPT.sicht)).toBe(false)

    // Unveraendert: ein Fingerabdruck, kein Laden.
    expect(await katalogNachladen()).toBe('unveraendert')
    expect(q.zaehler.laden).toBe(1)

    // Die Migration kommt nach dem Start (der Fall vom 19.10.2026).
    q.setzen(mitRezept(ALT))
    expect(await katalogNachladen()).toBe('neu')
    expect(q.zaehler.laden).toBe(2)
    const nachher = aktuellerKatalog()
    expect(nachher.sichten.get(REZEPT.sicht)?.koernung).toBe('Rezept, Zutat und Ebene')

    // Ausgetauscht, nicht veraendert: wer den alten Stand in der Hand haelt
    // (ein laufender Aufruf), sieht keinen halben neuen.
    expect(nachher).not.toBe(vorher)
    expect(vorher.sichten.has(REZEPT.sicht)).toBe(false)

    const z = log.zeilen.find(l => l.msg === 'Katalog nachgeladen')
    expect(z).toBeDefined()
    expect(z.stufe).toBe('info')
    expect(z.sichten).toBe(ALT.sichten.length + 1)
    expect(z.mit_koernung).toBeGreaterThan(0)
    expect(z.fallstricke).toBe(ALT.fallstricke.length)
    expect(z.neue_sichten).toEqual([REZEPT.sicht])
    expect(katalogZustand().nachladungen).toBe(1)
  })

  test('der Takt laedt von selbst nach', async () => {
    const q = attrappe(ALT)
    katalogZuruecksetzen(q.quelle)
    await katalogErstladen()
    q.setzen(mitRezept(ALT))
    const stopp = katalogBeobachten(10)
    try {
      for (let i = 0; i < 100 && !aktuellerKatalog().sichten.has(REZEPT.sicht); i++) {
        await Bun.sleep(10)
      }
    } finally { stopp() }
    expect(aktuellerKatalog().sichten.has(REZEPT.sicht)).toBe(true)
  })

  test('ein Fehltreffer laesst sofort nachsehen — gedrosselt', async () => {
    const q = attrappe(ALT)
    katalogZuruecksetzen(q.quelle)
    await katalogErstladen()
    const nachStart = q.zaehler.fingerabdruck

    // Bekannte Sichten fragen die Datenbank nicht.
    await katalogFuer(['mart.umsatz_tag'], 'test')
    expect(q.zaehler.fingerabdruck).toBe(nachStart)

    // Neue Sicht in der Datenbank, der Takt war noch nicht da.
    q.setzen(mitRezept(ALT))
    const k = await katalogFuer([REZEPT.sicht], 'sicht_beschreiben')
    expect(k.sichten.has(REZEPT.sicht)).toBe(true)
    expect(q.zaehler.fingerabdruck).toBe(nachStart + 1)
    expect(log.zeilen.find(l => l.msg === 'Katalog nachgeladen')?.anlass)
      .toBe('fehltreffer:sicht_beschreiben')

    // Ein Modell, das Namen raet: innerhalb der Frist KEINE weitere Abfrage.
    const jetzt = Date.now()
    for (let i = 0; i < 5; i++) {
      expect(await katalogFehltreffer('raten', jetzt + i)).toBe(false)
    }
    expect(q.zaehler.fingerabdruck).toBe(nachStart + 1)

    // Nach der Frist wieder eine — und ohne Aenderung kein Laden.
    const geladen = q.zaehler.laden
    expect(await katalogFehltreffer('raten', jetzt + FEHLTREFFER_ABSTAND_MS + 1)).toBe(false)
    expect(q.zaehler.fingerabdruck).toBe(nachStart + 2)
    expect(q.zaehler.laden).toBe(geladen)
  })

  test('eine unbekannte Regelart laesst den alten Katalog stehen und meldet laut', async () => {
    const q = attrappe(ALT)
    katalogZuruecksetzen(q.quelle)
    await katalogErstladen()
    const alt = aktuellerKatalog()
    expect(katalogStoerung()).toBeNull()

    // Der neue Katalog bringt eine neue Sicht UND eine Regel, die pruefen.ts nicht kennt.
    q.setzen(mitUnbekannterRegel(mitRezept(ALT)))
    expect(await katalogNachladen()).toBe('gesperrt')

    // Nichts davon ist in Umlauf: nicht die Regel, aber auch nicht die Sicht.
    expect(aktuellerKatalog()).toBe(alt)
    expect(aktuellerKatalog().sichten.has(REZEPT.sicht)).toBe(false)

    const fehler = log.zeilen.find(l => l.stufe === 'error')
    expect(fehler?.grund).toContain('gibt_es_nicht')
    expect(katalogStoerung()).toContain('gibt_es_nicht')
    expect(katalogZustand().gesperrt?.versuche).toBe(1)

    // Er versucht es weiter, auch auf demselben Stand — und meldet jedes Mal.
    expect(await katalogNachladen()).toBe('gesperrt')
    expect(katalogZustand().gesperrt?.versuche).toBe(2)
    expect(log.zeilen.filter(l => l.stufe === 'error').length).toBe(2)

    // Die Zeile kommt aus dem Katalog (aktiv = false): jetzt wird uebernommen.
    q.setzen(mitRezept(ALT))
    expect(await katalogNachladen()).toBe('neu')
    expect(aktuellerKatalog().sichten.has(REZEPT.sicht)).toBe(true)
    expect(katalogStoerung()).toBeNull()
    expect(katalogZustand().gesperrt).toBeNull()
    expect(log.zeilen.some(l => l.msg === 'Katalogsperre aufgehoben')).toBe(true)
  })

  test('beim Start bleibt eine unbekannte Regelart ein harter Abbruch', async () => {
    const q = attrappe(mitUnbekannterRegel(ALT))
    katalogZuruecksetzen(q.quelle)
    await expect(katalogErstladen()).rejects.toThrow('gibt_es_nicht')
  })

  test('nicht lesbar: alter Katalog bleibt; ein Takt, der lange nicht prueft, ist eine Stoerung', async () => {
    const q = attrappe(ALT)
    katalogZuruecksetzen(q.quelle)
    await katalogErstladen()
    const alt = aktuellerKatalog()
    q.kaputtMachen(true)
    expect(await katalogNachladen()).toBe('lesefehler')
    expect(aktuellerKatalog()).toBe(alt)
    expect(katalogZustand().lesefehler?.fehler).toContain('Verbindung weg')
    // Kurz: keine Stoerung. Zehn Takte ohne Pruefung: Stoerung.
    expect(katalogStoerung()).toBeNull()
    expect(katalogStoerung(Date.now() + STILLSTAND_MS + 1000)).toContain('nicht mehr geprueft')
    q.kaputtMachen(false)
    expect(await katalogNachladen()).toBe('unveraendert')
    expect(katalogZustand().lesefehler).toBeNull()
  })
})

// ---------------------------------------------------------------------
// Gegen einen lokalen Klon
// ---------------------------------------------------------------------

const LESEN = process.env.MCP_DATABASE_URL
const SCHREIBEN = process.env.MCP_TEST_SCHREIB_URL

/** Nur localhost und nur ein Klon — siehe Kopf. Wirft sonst, statt zu schreiben. */
function schreibzielPruefen(url: string): void {
  const u = new URL(url)
  const db = u.pathname.replace(/^\//, '')
  if (!['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) || (u.port && u.port !== '5432')) {
    throw new Error(`MCP_TEST_SCHREIB_URL zeigt nicht auf den lokalen Server (${u.host}) — Abbruch.`)
  }
  if (!/^lina_mcp_|_test|_klon/.test(db)) {
    throw new Error(`MCP_TEST_SCHREIB_URL zeigt auf "${db}", keinen Klon — Abbruch.`)
  }
  if (LESEN && new URL(LESEN).pathname !== u.pathname) {
    throw new Error('MCP_DATABASE_URL und MCP_TEST_SCHREIB_URL zeigen auf verschiedene Datenbanken.')
  }
}

const mitKlon = LESEN && SCHREIBEN ? describe : describe.skip

mitKlon('Katalog nachladen (lokaler Klon)', () => {
  let admin: pg.Client
  let log: ReturnType<typeof logMitlesen>
  const SICHT = 'mart.zz_nachladen_probe'

  const aufraeumen = async () => {
    await admin.query(`DELETE FROM mcp.fallstrick WHERE schluessel = $1`, [UNBEKANNT.schluessel])
    await admin.query(`DELETE FROM mcp.sicht WHERE sicht = $1`, [SICHT])
    await admin.query(`DROP VIEW IF EXISTS ${SICHT}`)
  }

  beforeAll(async () => {
    schreibzielPruefen(SCHREIBEN!)
    admin = new pg.Client({ connectionString: SCHREIBEN })
    await admin.connect()
    await aufraeumen()
  })
  afterAll(async () => {
    await aufraeumen()
    await admin.end()
    katalogZuruecksetzen()
  })
  beforeEach(() => { log = logMitlesen() })
  afterEach(() => { log.aus() })

  test('neue Sicht, unbekannte Regelart, Behebung — als mcp_leser gelesen', async () => {
    katalogZuruecksetzen()           // die echte Quelle: Datenbank
    await katalogErstladen()
    expect(aktuellerKatalog().sichten.has(SICHT)).toBe(false)
    expect(await katalogNachladen()).toBe('unveraendert')

    // Was eine Migration tut: Sicht anlegen, Katalogzeile mit Koernung.
    await admin.query(`CREATE VIEW ${SICHT} AS SELECT 1::int AS rezept_id, 'x'::text AS rezept`)
    await admin.query(`INSERT INTO mcp.sicht (sicht, koernung, thema) VALUES ($1, 'Probe je Rezept', 'test')`,
      [SICHT])
    expect(await katalogNachladen()).toBe('neu')
    const s = aktuellerKatalog().sichten.get(SICHT)
    expect(s?.koernung).toBe('Probe je Rezept')
    expect(s?.spalten).toEqual(['rezept_id', 'rezept'])

    // Eine Regelart, die pruefen.ts nicht kennt: alter Katalog bleibt.
    const vorher = aktuellerKatalog()
    await admin.query(`INSERT INTO mcp.fallstrick (schluessel, art, schwere, hinweis)
                       VALUES ($1, $2, 'sperre', 'Probe')`, [UNBEKANNT.schluessel, UNBEKANNT.art])
    expect(await katalogNachladen()).toBe('gesperrt')
    expect(aktuellerKatalog()).toBe(vorher)
    expect(katalogStoerung()).toContain(UNBEKANNT.art)

    // Behoben: die Zeile auf aktiv = false — der neue Katalog wird uebernommen.
    await admin.query(`UPDATE mcp.fallstrick SET aktiv = false WHERE schluessel = $1`, [UNBEKANNT.schluessel])
    expect(await katalogNachladen()).toBe('neu')
    expect(katalogStoerung()).toBeNull()
  })
})
