/**
 * Die zwei Phasen von sync.ts — und dass die Grenze zwischen ihnen hält.
 *
 * ANLASS (24.08.2026). Bis dahin war sync.ts eine Kette von `await`s: erst
 * der Import, dann Yext, Handpflege, Bounti, dann alles Materialisierte.
 * Nachgemessen an Lauf 101 stand die FoodNotify-Spur nach zwei Stunden still,
 * während Yext und Bounti weitere acht Stunden warteten, um dann zwanzig
 * Minuten zu arbeiten. Seitdem gilt die Faustregel: **alle separaten Dienste
 * parallelisieren.**
 *
 * DIESER TEST SCHÜTZT DIE BEIDEN ZUSAGEN, DIE DABEI TEUER WERDEN KÖNNTEN:
 *
 *   1. **Kein Dienst fällt heraus.** Genau so stand LINA am 02.08.2026 acht
 *      Tage still: das Einreihen war ein zweiter Zeitplan, fiel aus, und der
 *      Sync-Lauf meldete weiter „ok". Ein Dienst, der aus sync.ts
 *      verschwindet, hinterlässt keine Fehlermeldung — er hinterlässt gar
 *      nichts. Für Yext gab es diesen Wächter seit dem 14.08.2026, für
 *      Wetter, Handpflege und Bounti nicht.
 *
 *   2. **Phase A ist vollständig abgewartet, bevor Phase B beginnt.** Das ist
 *      die Bedingung, an der die ganze Parallelisierung hängt: Yext und die
 *      Handpflege schreiben Round-Table-Kennzahlen, und
 *      `mart.round_table_monat` ist seit Migration 0039 materialisiert. Liefe
 *      der Refresh los, während die beiden noch schreiben, trüge die Ampel
 *      die Note vom Vortag — derselbe Fehler wie am 14.08.2026, nur diesmal
 *      als Wettlauf statt als Reihenfolge, also nicht einmal verlässlich
 *      reproduzierbar.
 *
 * Geprüft wird am QUELLTEXT und nicht am Verhalten. Das ist grob, aber es ist
 * die einzige Ebene, auf der „ein Aufruf fehlt" überhaupt sichtbar ist: ein
 * Verhaltenstest ohne den Aufruf ist grün, weil nichts passiert.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

const sync = await Bun.file(`${import.meta.dir}/../sync.ts`).text()

/** Der Punkt, an dem Phase A vollständig eingesammelt ist. */
const SAMMELPUNKT = 'await Promise.allSettled(dienste'

/** Die Dienste, die nebeneinander laufen. Name in der Liste → Funktion. */
const DIENSTE: Array<[string, string]> = [
  ['yext', 'yextNachlauf'],
  ['bounti', 'bountiNachlauf'],
  ['wetter', 'wetterNachlauf'],
  ['handpflege', 'pflegeNachlauf'],
]

/**
 * Phase B: alles, was auf dem rechnet, was Phase A geladen hat. Jede dieser
 * Funktionen MUSS hinter dem Sammelpunkt stehen.
 */
const PHASE_B = [
  'zuordnungNachlauf',
  'deckungsbeitragNachlauf',
  'roundTableNachlauf',
  'betriebsberichtSichtenNachlauf',
  'auswahllistenNachlauf',
  'vergleichstagNachlauf',
  'einkaufspreisNachlauf',
  'einkaufSichtenNachlauf',
  'pflichtartikelSichtenNachlauf',
  'zulaufPruefen',
]

describe('sync.ts — Phase A und Phase B', () => {
  test('der Sammelpunkt existiert', () => {
    // Ohne ihn gäbe es keine Grenze, und alle Prüfungen darunter wären
    // wertlos — deshalb zuerst und einzeln.
    expect(sync.indexOf(SAMMELPUNKT)).toBeGreaterThan(0)
  })

  test('alle vier Dienste stehen in der Liste der Phase A', () => {
    const fehlt = DIENSTE.filter(([name, fn]) =>
      !new RegExp(`\\['${name}',\\s*${fn}\\(\\)\\]`).test(sync))
    expect(fehlt.map(([n]) => n)).toEqual([])
  })

  test('der Import läuft neben den Diensten, nicht davor', () => {
    // Seit 0116 eine Sitzung: geöffnet und Phase A gestartet VOR dem Sammelpunkt.
    const start = sync.indexOf('const importP = (async () => {')
    expect(start).toBeGreaterThan(0)
    const oeffnen = sync.indexOf('await workerOeffnen(')
    const phaseA = sync.indexOf('await sitzung.tagesgeschaeft()')
    expect(oeffnen).toBeGreaterThan(start)
    expect(phaseA).toBeGreaterThan(oeffnen)
    expect(phaseA).toBeLessThan(sync.indexOf(SAMMELPUNKT))
    // Gestartet VOR dem Sammelpunkt — sonst wäre er wieder in Reihe.
    expect(start).toBeLessThan(sync.indexOf(SAMMELPUNKT))
    /*
     * Und sein Fehler wird sofort aufgefangen. Ohne diesen `then` wäre eine
     * Ablehnung des Imports eine unbehandelte Zusage, solange wir noch auf
     * die Dienste warten — Bun beendet den Prozess dann mitten im Lauf, und
     * `sync.lauf` bliebe für immer offen.
     */
    const auffangen = sync.indexOf('const importErgebnis = importP.then(')
    expect(auffangen).toBeGreaterThan(start)
    expect(auffangen).toBeLessThan(sync.indexOf(SAMMELPUNKT))
  })

  test('der Import wirft weiterhin den Lauf ab, nur später', () => {
    // Die Fehlersemantik darf sich durch die Parallelisierung NICHT ändern:
    // scheitert der Import, scheitert der Lauf.
    expect(sync).toContain("if (imp.status === 'abgelehnt') throw imp.grund")
  })

  test('jede Ableitung steht hinter dem Sammelpunkt', () => {
    const grenze = sync.indexOf(SAMMELPUNKT)
    const davor = PHASE_B.filter(fn => {
      const i = sync.indexOf(`await ${fn}(`)
      return i > 0 && i < grenze
    })
    expect(davor).toEqual([])
  })

  test('jede Ableitung wird überhaupt aufgerufen', () => {
    // Dieselbe Falle wie bei den Diensten, nur auf der anderen Seite der
    // Grenze: ein Refresh, der herausfällt, lässt eine materialisierte Sicht
    // einfrieren — und eine eingefrorene Sicht sieht aus wie eine gepflegte.
    const fehlt = PHASE_B.filter(fn => !sync.includes(`await ${fn}(`))
    expect(fehlt).toEqual([])
  })
})

/**
 * PHASE C (Entscheidung 23.09.2026, Migration 0116): „Erst Tagesgeschäft,
 * dann nachladen." Die Zusage, die hier teuer werden kann, ist die
 * Reihenfolge: rutscht `nachladen()` vor eine Ableitung, laufen die
 * Dashboards wieder bis zum Abend auf dem Vortag — und nichts meldet sich,
 * weil ein Lauf, der spät auffrischt, genauso aussieht wie einer, der früh
 * auffrischt. Wieder am Quelltext, aus demselben Grund wie oben.
 */
describe('sync.ts — Phase C nach Phase B', () => {
  const NACHLADEN = 'const c = await sitzung.nachladen()'
  const ABLEITUNGEN_FERTIG = 'await sitzung.ableitungenFertig()'
  const ABSCHLUSS = 'r = await sitzung.abschliessen({ stummeQuellen: stumm })'

  /** Das ERSTE Vorkommen — die Ableitung in Phase B, nicht die Wiederholung nach C. */
  const erstes = (fn: string) => sync.indexOf(`await ${fn}(`)

  test('Phase C wird gestartet, und zwar genau einmal', () => {
    expect(sync.indexOf(NACHLADEN)).toBeGreaterThan(0)
    expect(sync.split('sitzung.nachladen()').length - 1).toBe(1)
  })

  test('jede Ableitung steht VOR dem Nachladen', () => {
    const c = sync.indexOf(NACHLADEN)
    const dahinter = PHASE_B.filter(fn => erstes(fn) > c)
    expect(dahinter).toEqual([])
  })

  test('das Ende von Phase B wird gestempelt — nach der Zulaufprüfung, vor dem Nachladen', () => {
    const stempel = sync.indexOf(ABLEITUNGEN_FERTIG)
    expect(stempel).toBeGreaterThan(erstes('zulaufPruefen'))
    expect(stempel).toBeLessThan(sync.indexOf(NACHLADEN))
  })

  test('nach Phase C wird nur aufgefrischt, was Phase C berührt — und nur, wenn sie Konzerndaten schrieb', () => {
    const c = sync.indexOf(NACHLADEN)
    const abschluss = sync.indexOf(ABSCHLUSS)
    expect(abschluss).toBeGreaterThan(c)
    const block = sync.slice(c, abschluss)
    expect(block).toContain('if (c.konzernOk > 0)')
    /*
     * Die drei Sichten auf core.umsatzbericht_tag und core.artikelverkauf_tag
     * (pg_depend, 23.09.2026). Wer hier eine vierte ergänzt oder eine
     * streicht, prüft zuerst, woraus sie liest — docs/importer.md, „Drei
     * Phasen".
     */
    for (const fn of ['deckungsbeitragNachlauf', 'roundTableNachlauf', 'vergleichstagNachlauf']) {
      expect(block).toContain(`await ${fn}(`)
    }
    // Und nichts, was Phase C nicht berührt: kein Einkauf, keine Zulaufprüfung.
    for (const fn of ['einkaufSichtenNachlauf', 'pflichtartikelSichtenNachlauf', 'zulaufPruefen', 'zuordnungNachlauf']) {
      expect(block).not.toContain(`await ${fn}(`)
    }
  })

  /**
   * Die Kassensichten (0117) lesen, was Phase C an Betriebsbericht-Historie
   * schreibt — sie werden nach C noch einmal aufgefrischt, sobald C ueberhaupt
   * gearbeitet hat. Fehlte der Aufruf, stuende der Backfill einer Nacht erst
   * einen Tag spaeter im Ladestand (docs/importer.md, "Drei Phasen").
   */
  test('nach Phase C werden die Kassensichten aufgefrischt, wenn C Posten bearbeitet hat', () => {
    const c = sync.indexOf(NACHLADEN)
    const block = sync.slice(c, sync.indexOf(ABSCHLUSS))
    expect(block).toContain('if (c.posten > 0)')
    const bedingung = block.indexOf('if (c.posten > 0)')
    expect(block.indexOf('await betriebsberichtSichtenNachlauf(', bedingung)).toBeGreaterThan(bedingung)
  })

  test('der Lauf wird erst nach Phase C geschlossen, mit dem Ergebnis der Zulaufprüfung', () => {
    expect(sync.indexOf(ABSCHLUSS)).toBeGreaterThan(sync.indexOf(NACHLADEN))
    expect(sync).toContain('stumm = await zulaufPruefen(sitzung.laufId)')
  })
})

/**
 * DAS VERHALTEN, gegen die Attrappe und eine eigene Testdatenbank.
 *
 * Übersprungen ohne TEST_DATABASE_URL. Die Datei macht TRUNCATE über die
 * Warteschlange und die Laufprotokolle — sie braucht eine EIGENE
 * Testdatenbank (Schema-Klon ab 0116), nie die, auf die DATABASE_URL zeigt.
 * Immer die ganze Datei laufen lassen, nie mit -t: die Notbremse sitzt im
 * beforeAll (Notiz „e2e-Test mit -t trifft Produktiv-DB").
 */
const DB = process.env.TEST_DATABASE_URL
if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — '
    + 'diese Datei macht TRUNCATE. Eine eigene Testdatenbank anlegen.')
}
const mitDb = DB ? describe : describe.skip

mitDb('Worker: Tagesgeschäft, dann Nachladen (mit Datenbank)', () => {
  let db: import('pg').Client
  let mock: { url: string; stop: () => void }
  let cfg: any

  beforeAll(async () => {
    const { mockStarten } = await import('../lina/mock')
    mock = mockStarten({})
    process.env.LINA_BASE_URL = mock.url
    process.env.LINA_USER = 'testuser'
    process.env.LINA_PASSWORD = 'geheim'
    process.env.DATABASE_URL = DB!
    process.env.TAKT_MIN_MS = '0'
    process.env.TAKT_MAX_MS = '0'
    process.env.FN_TAKT_MIN_MS = '0'
    process.env.FN_TAKT_MAX_MS = '0'
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB) {
      throw new Error('config wurde vorher mit einer anderen DATABASE_URL geladen — '
        + 'diese Datei einzeln starten: bun test src/sync/phasen.test.ts')
    }
    cfg = config
    cfg.LINA_BASE_URL = mock.url
    cfg.TAKT_MIN_MS = 0
    cfg.TAKT_MAX_MS = 0
    cfg.MAX_POSTEN_PRO_LAUF = 0
    const { Client } = await import('pg')
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`INSERT INTO core.betrieb (enc_id, name) VALUES ('test-duesseldorf', 'Test Duesseldorf (phasen)')
                    ON CONFLICT (enc_id) DO NOTHING`)
  })

  afterAll(async () => { mock?.stop(); await db?.end() })

  /** Drei Tagesposten, drei Historientage, zwei Betriebsbericht-Posten je Art. */
  const schlangeAufbauen = async () => {
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf RESTART IDENTITY`)
    await db.query(`
      INSERT INTO sync.warteschlange
        (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet, nachladen) VALUES
        ('getUmsatzbericht', NULL, '2026-09-20', '2026-09-20', 10, false),
        ('getUmsatzbericht', NULL, '2026-09-21', '2026-09-21', 10, false),
        ('getUmsatzbericht', NULL, '2026-09-22', '2026-09-22', 10, false),
        ('getReport:92', 'test-duesseldorf', '2026-09-14', '2026-09-14', 85, false),
        ('getUmsatzbericht', NULL, '2019-03-01', '2019-03-01', 90, true),
        ('getUmsatzbericht', NULL, '2019-03-02', '2019-03-02', 90, true),
        ('getUmsatzbericht', NULL, '2019-03-03', '2019-03-03', 90, true),
        ('getReport:92', 'test-duesseldorf', '2019-03-01', '2019-03-01', 85, true)`)
  }

  const aufgaben = async (): Promise<string[]> =>
    (await db.query(`SELECT endpunkt, zeitraum_von::text AS von FROM sync.aufgabe ORDER BY aufgabe_id`))
      .rows.map(r => `${r.endpunkt}@${r.von}`)

  test('Phase A zieht kein Nachladen — Phase C danach alles, verschränkt', async () => {
    cfg.TAGESBUDGET = 10000
    cfg.BETRIEBSBERICHT_JE_LAUF = 10000
    await schlangeAufbauen()
    const { workerOeffnen } = await import('./worker')
    const s = await workerOeffnen('manuell')
    expect(s.ohneArbeit).toBeNull()

    const a = await s.tagesgeschaeft()
    const nachA = await aufgaben()
    // Nur die vier Posten mit nachladen = false, kein einziger aus 2019.
    expect(nachA.filter(x => x.includes('@2019'))).toEqual([])
    expect(nachA.length).toBe(4)
    expect(a.posten).toBe(4)
    const { rows: [zwischen] } = await db.query(
      `SELECT status, tagesgeschaeft_bis IS NOT NULL AS a, ableitungen_bis IS NOT NULL AS b
         FROM sync.lauf WHERE lauf_id = $1`, [s.laufId])
    // Der Lauf steht nach Phase A weiter auf laeuft — beendet ist er erst nach C.
    expect(zwischen).toEqual({ status: 'laeuft', a: true, b: false })

    await s.ableitungenFertig()
    const c = await s.nachladen()
    const alle = await aufgaben()
    // Phase C beginnt erst NACH dem Stempel von Phase B …
    const { rows: [t] } = await db.query(
      `SELECT l.ableitungen_bis <= min(a.beendet_am) AS c_nach_b
         FROM sync.lauf l JOIN sync.aufgabe a ON a.lauf_id = l.lauf_id
        WHERE l.lauf_id = $1 AND a.zeitraum_von < '2020-01-01' GROUP BY l.ableitungen_bis`, [s.laufId])
    expect(t.c_nach_b).toBe(true)
    // … und holt die vier Nachlade-Posten, Betriebsbericht zuerst verschränkt.
    const folge = alle.slice(4).map(x => x.startsWith('getReport:') ? 'B' : 'K').join('')
    expect(folge).toBe('BKKK')
    expect(c.posten).toBe(4)
    expect(c.konzernOk).toBe(3)

    const r = await s.abschliessen({ stummeQuellen: 0 })
    expect(r.status).toBe('ok')
    expect(r.nachladen).toEqual({ posten: 4, offen: 0 })
    const { rows: [l] } = await db.query(
      `SELECT status, nachladen_posten, nachladen_offen, beendet_am IS NOT NULL AS zu, notiz
         FROM sync.lauf WHERE lauf_id = $1`, [s.laufId])
    expect(l).toMatchObject({ status: 'ok', nachladen_posten: 4, nachladen_offen: 0, zu: true })
    expect(l.notiz).toContain('Tagesgeschaeft erledigt')
    expect(l.notiz).toContain('Nachladen:')
  })

  test('Phase C respektiert das Tagesbudget — EINE Obergrenze, Phase A zuerst', async () => {
    // Budget 6: vier Posten Tagesgeschäft, dann bleiben genau zwei fürs Nachladen.
    cfg.TAGESBUDGET = 6
    await schlangeAufbauen()
    const { workerOeffnen } = await import('./worker')
    const s = await workerOeffnen('manuell')
    await s.tagesgeschaeft()
    await s.ableitungenFertig()
    const c = await s.nachladen()
    expect(c.posten).toBe(2)
    const r = await s.abschliessen()
    // Die zwei, die nicht mehr passten, stehen als offen da — sichtbar, nicht still.
    expect(r.nachladen).toEqual({ posten: 2, offen: 2 })
    const { rows: [l] } = await db.query(
      `SELECT notiz, nachladen_offen FROM sync.lauf WHERE lauf_id = $1`, [s.laufId])
    expect(l.notiz).toContain('Tagesbudget aufgebraucht')
    expect(l.notiz).toContain('2 offen')
    // Und alle Aufgaben zusammen: nicht mehr als das Budget.
    expect((await aufgaben()).length).toBe(6)
    cfg.TAGESBUDGET = 10000
  })

  test('Regel 10: ein Nachladen, das nichts schafft, obwohl etwas fällig ist, ist nicht ok', async () => {
    // Budget 4: das Tagesgeschäft verbraucht alles, Phase C bekommt nichts.
    cfg.TAGESBUDGET = 4
    await schlangeAufbauen()
    const { workerOeffnen } = await import('./worker')
    const s = await workerOeffnen('manuell')
    await s.tagesgeschaeft()
    await s.ableitungenFertig()
    await s.nachladen()
    const r = await s.abschliessen()
    expect(r.status).toBe('teilweise')
    const { rows: [l] } = await db.query(
      `SELECT notiz, nachladen_posten, nachladen_offen FROM sync.lauf WHERE lauf_id = $1`, [s.laufId])
    expect(l.nachladen_posten).toBe(0)
    expect(l.nachladen_offen).toBe(4)
    expect(l.notiz).toContain('NICHTS nachgeladen')
    cfg.TAGESBUDGET = 10000
  })

  test('stumme Quellen aus Phase B stufen den Lauf beim Abschluss herab — und ihre Notiz bleibt', async () => {
    await schlangeAufbauen()
    const { workerOeffnen } = await import('./worker')
    const s = await workerOeffnen('manuell')
    await s.tagesgeschaeft()
    // So schreibt zulaufPruefen() in Phase B: der Lauf steht auf laeuft.
    await db.query(`UPDATE sync.lauf SET notiz = concat_ws(' | ', nullif(notiz, ''), 'test: 1 Quelle(n) ohne Zulauf')
                     WHERE lauf_id = $1`, [s.laufId])
    await s.ableitungenFertig()
    await s.nachladen()
    const r = await s.abschliessen({ stummeQuellen: 1 })
    expect(r.status).toBe('teilweise')
    const { rows: [l] } = await db.query(`SELECT notiz FROM sync.lauf WHERE lauf_id = $1`, [s.laufId])
    expect(l.notiz).toContain('LINA:')
    expect(l.notiz).toContain('test: 1 Quelle(n) ohne Zulauf')
  })

  test('die Einreihwege der Historie setzen nachladen — der automatische und der Handweg', async () => {
    await db.query(`TRUNCATE sync.warteschlange RESTART IDENTITY`)
    const vorher = { je: cfg.HISTORIE_JE_LAUF, ab: cfg.HISTORIE_AB }
    cfg.HISTORIE_JE_LAUF = 5
    cfg.HISTORIE_AB = '2026-09-01'
    const { historieNachziehen } = await import('./nachfuellen')
    expect(await historieNachziehen()).toBe(5)
    await db.query(`SELECT sync.historie_einreihen('getUmsatzbericht', DATE '2019-01-01', DATE '2019-01-03')`)
    const { rows: [r] } = await db.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE nachladen)::int AS nachladen FROM sync.warteschlange`)
    expect(r).toEqual({ n: 8, nachladen: 8 })
    cfg.HISTORIE_JE_LAUF = vorher.je
    cfg.HISTORIE_AB = vorher.ab
  })

  test('die Laufsperre hält über Phase B: ein zweiter Start dazwischen arbeitet nicht', async () => {
    await schlangeAufbauen()
    const { workerOeffnen } = await import('./worker')
    const s = await workerOeffnen('manuell')
    await s.tagesgeschaeft()
    const zweiter = await workerOeffnen('manuell')
    expect(zweiter.ohneArbeit?.status).toBe('lauf_uebersprungen')
    await s.ableitungenFertig()
    await s.nachladen()
    await s.abschliessen()
  })
})
