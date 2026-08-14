/**
 * Der eine Importweg für die Handpflege (Migration `0079`, Plan Phase 6).
 *
 * WAS HIER GEPRÜFT WIRD, IST NICHT „läuft es durch" — sondern die Frage
 * dahinter: **was passiert, wenn die Datei kaputt ist?** Eine Datei, die zu
 * 90 % durchläuft, ist die schlechteste aller Möglichkeiten, weil sie wie ein
 * Erfolg aussieht. Jeder Fehlerfall hier endet deshalb mit „gar nichts
 * geschrieben" und einer Meldung, die sagt, was zu tun ist.
 *
 * Die Zerlegung braucht keine Datenbank und wird deshalb getrennt geprüft.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { csvLesen, dateiEinlesen, ZIELE, type Ziel } from './tabellen'
import { query } from '../db/pool'

describe('csvLesen', () => {
  test('erkennt das Trennzeichen an der Kopfzeile', () => {
    expect(csvLesen('a;b;c\n1;2;3').kopf).toEqual(['a', 'b', 'c'])
    expect(csvLesen('a,b,c\n1,2,3').kopf).toEqual(['a', 'b', 'c'])
  })

  /**
   * DER FALL, DER DEN PARSER GEKOSTET HAT. Die erste exportierte Notiz
   * lautete wörtlich:
   *   "…, Blatt Eingabe; Zuordnung ueber Stadt ""Köln"", Umsatzprobe exakt"
   * — ein Semikolon UND doppelte Anführungszeichen in einem Feld. Ein
   * `split(';')` hätte daraus zwei Spalten gemacht, die Datei wäre abgewiesen
   * worden, und der Grund („unbekannte Spalte") hätte in die Irre geführt.
   */
  test('ein Trennzeichen in Anfuehrungszeichen trennt nicht', () => {
    const { zeilen } = csvLesen(
      'betrieb;notiz\nCOYACAN GmbH;"Blatt Eingabe; Stadt ""Köln"", Probe exakt"')
    expect(zeilen[0]).toEqual(['COYACAN GmbH', 'Blatt Eingabe; Stadt "Köln", Probe exakt'])
  })

  test('leere Felder bleiben leer, nicht weg', () => {
    expect(csvLesen('a;b;c\n1;;3').zeilen[0]).toEqual(['1', '', '3'])
  })

  test('die Kopfzeile wird kleingeschrieben — Excel schreibt gross', () => {
    expect(csvLesen('Betrieb;Monat\nx;y').kopf).toEqual(['betrieb', 'monat'])
  })
})

describe('Register', () => {
  test('jeder Schluessel steht auch in den erlaubten Spalten', () => {
    for (const z of ZIELE) {
      const fehlt = z.schluessel.filter(s => !z.spalten.includes(s))
      expect({ datei: z.datei, fehlt }).toEqual({ datei: z.datei, fehlt: [] })
    }
  })

  test('jede Pflichtspalte ist auch erlaubt', () => {
    for (const z of ZIELE) {
      const fehlt = z.pflicht.filter(s => !z.spalten.includes(s))
      expect({ datei: z.datei, fehlt }).toEqual({ datei: z.datei, fehlt: [] })
    }
  })

  test('die Dateinamen sind eindeutig', () => {
    const n = ZIELE.map(z => z.datei)
    expect(n).toHaveLength(new Set(n).size)
  })
})

const DB = process.env.TEST_DATABASE_URL
const lauf = DB ? describe : describe.skip

/**
 * GEPRUEFT WIRD UEBER DENSELBEN POOL, den `dateiEinlesen` benutzt — nicht
 * ueber eine zweite Verbindung auf TEST_DATABASE_URL.
 *
 * Der Grund ist der Fehler, den AGENTS.md fuer den Ende-zu-Ende-Test
 * beschreibt: `config` friert `DATABASE_URL` beim ersten Import ein. Eine
 * zweite Verbindung wuerde dann eine ANDERE Datenbank pruefen als die, in die
 * der Import schreibt — und der Test waere gruen oder rot, je nachdem, welche
 * Testdatei zuerst lief. Ein Test, der auf die falsche Datenbank sieht, ist
 * schlimmer als keiner.
 *
 * Diese Datei macht kein TRUNCATE und raeumt nur ihre eigenen Zeilen weg; sie
 * darf deshalb auf derselben Datenbank laufen wie der Rest.
 */
lauf('dateiEinlesen', () => {
  const ziel = ZIELE.find(z => z.datei === 'om_einschaetzung.csv')! as Ziel

  beforeAll(async () => {
    await query(
      `INSERT INTO core.betrieb (name, enc_id) VALUES ('Pflege Testbetrieb','pflege-enc-1')
       ON CONFLICT (enc_id) DO UPDATE SET name = excluded.name`)
  })
  afterAll(async () => {
    await query(`DELETE FROM manual.om_einschaetzung
                  WHERE betrieb_key IN (SELECT betrieb_key FROM core.betrieb
                                         WHERE enc_id = 'pflege-enc-1')`)
    await query(`DELETE FROM core.betrieb WHERE enc_id = 'pflege-enc-1'`)
    // KEIN pool.end(): `bun test` teilt die Modulregistrierung ueber
    // Testdateien hinweg — ein geschlossener Pool riss die naechste Datei mit
    // ("Cannot use a pool after calling end"). Der Prozess raeumt ihn selbst.
  })

  const zahl = async () => Number((await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM manual.om_einschaetzung o
       JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = 'pflege-enc-1'`))[0]!.n)

  test('der Betrieb darf als NAME stehen — niemand pflegt gegen betrieb_key = 87', async () => {
    const b = await dateiEinlesen(ziel,
      'betrieb;monat;om_score\nPflege Testbetrieb;2026-07-01;4')
    expect(b.fehler).toBeNull()
    expect(b.geschrieben).toBe(1)
    expect(await zahl()).toBe(1)
  })

  test('derselbe Monat zweimal ueberschreibt, statt zu verdoppeln', async () => {
    await dateiEinlesen(ziel, 'betrieb;monat;om_score\nPflege Testbetrieb;2026-07-01;2')
    expect(await zahl()).toBe(1)
    const [r] = await query<{ om_score: number }>(
      `SELECT om_score FROM manual.om_einschaetzung o JOIN core.betrieb b USING (betrieb_key)
        WHERE b.enc_id = 'pflege-enc-1'`)
    expect(Number(r!.om_score)).toBe(2)
  })

  /**
   * DER WICHTIGSTE TEST DER DATEI. Ein Tippfehler im Betriebsnamen ist der
   * wahrscheinlichste Fehler überhaupt — und der einzige, bei dem ein
   * nachsichtiger Importer eine Note **verschwinden** ließe, ohne dass
   * irgendwo etwas rot wird. Die Note wäre weg, die Ampel grau, und niemand
   * käme auf die Datei.
   */
  test('ein unbekannter Betriebsname weist die GANZE Datei ab', async () => {
    const vorher = await zahl()
    const b = await dateiEinlesen(ziel,
      'betrieb;monat;om_score\n'
      + 'Pflege Testbetrieb;2026-08-01;5\n'
      + 'Enchilada Atlantis;2026-08-01;3')
    expect(b.fehler).toContain('enchilada atlantis')
    expect(b.geschrieben).toBe(0)
    // Und die erste, gute Zeile ist AUCH nicht drin.
    expect(await zahl()).toBe(vorher)
  })

  test('eine unbekannte Spalte weist die Datei ab und nennt sie', async () => {
    const b = await dateiEinlesen(ziel,
      'betrieb;monat;om_score;bemerkungen\nPflege Testbetrieb;2026-09-01;4;hm')
    expect(b.fehler).toContain('bemerkungen')
    expect(b.geschrieben).toBe(0)
  })

  test('eine fehlende Pflichtspalte weist die Datei ab', async () => {
    const b = await dateiEinlesen(ziel, 'betrieb;monat\nPflege Testbetrieb;2026-09-01')
    expect(b.fehler).toContain('om_score')
    expect(b.geschrieben).toBe(0)
  })

  /**
   * Alles aus einer CSV ist Text; `om_score` ist `smallint`. Der Cast steht
   * deshalb im INSERT — und eine Zahl, die keine ist, lässt ihn werfen. Auch
   * hier: ganz oder gar nicht.
   */
  test('eine Zahl, die keine ist, weist die Datei ab', async () => {
    const vorher = await zahl()
    const b = await dateiEinlesen(ziel,
      'betrieb;monat;om_score\nPflege Testbetrieb;2026-10-01;sehr gut')
    expect(b.fehler).not.toBeNull()
    expect(b.geschrieben).toBe(0)
    expect(await zahl()).toBe(vorher)
  })

  test('eine leere Datei ist ein Fehler, kein stiller Erfolg', async () => {
    const b = await dateiEinlesen(ziel, '')
    expect(b.fehler).toBe('leere Datei')
  })
})
