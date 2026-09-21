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

/**
 * `betrieb_standort.csv` — der Weg, auf dem die sieben fehlenden Standorte
 * hereinkommen sollen (Befund 21.09.2026, Liste in `docs/offene-punkte.md`).
 *
 * WARUM DIESES ZIEL EIGENE TESTS BRAUCHT UND `om_einschaetzung` OBEN NICHT
 * GENUEGT: `manual.betrieb_standort` ist das einzige Pflegeziel mit
 * Wertebereichsprüfungen in der Tabelle selbst — Koordinaten nur paarweise,
 * und nur grob in Mitteleuropa. Beide fangen genau die Fehler ab, die beim
 * Abtippen aus einer Adressliste entstehen, und beide müssen als
 * **abgewiesene Datei** ankommen und nicht als halber Import.
 */
lauf('dateiEinlesen: betrieb_standort', () => {
  const ziel = ZIELE.find(z => z.datei === 'betrieb_standort.csv')! as Ziel

  beforeAll(async () => {
    await query(
      `INSERT INTO core.betrieb (name, enc_id) VALUES ('Standort Testbetrieb','standort-enc-1')
       ON CONFLICT (enc_id) DO UPDATE SET name = excluded.name`)
  })
  afterAll(async () => {
    await query(`DELETE FROM manual.betrieb_standort
                  WHERE betrieb_key IN (SELECT betrieb_key FROM core.betrieb
                                         WHERE enc_id = 'standort-enc-1')`)
    await query(`DELETE FROM core.betrieb WHERE enc_id = 'standort-enc-1'`)
  })

  const punkt = async () => (await query<{ breitengrad: string | null; ort: string | null }>(
    `SELECT s.breitengrad, s.ort FROM manual.betrieb_standort s
       JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = 'standort-enc-1'`))[0] ?? null

  test('eine Adresse mit Koordinate kommt an', async () => {
    const b = await dateiEinlesen(ziel,
      'betrieb;strasse;plz;ort;breitengrad;laengengrad;herkunft;genauigkeit\n'
      + 'Standort Testbetrieb;Marktplatz 1;97070;Würzburg;49.793000;9.951000;manuell;adresse')
    expect(b.fehler).toBeNull()
    expect(b.geschrieben).toBe(1)
    expect((await punkt())!.ort).toBe('Würzburg')
  })

  /**
   * DER FEHLER, DEN DIE TABELLE AUSDRUECKLICH ABFAENGT (Migration `0008`):
   * 49.8/9.9 ist Würzburg, 9.9/49.8 liegt im Golf von Guinea. Beim Abtippen
   * aus einer Liste ist das der wahrscheinlichste Griff daneben — und ohne
   * die Prüfung stünde der Betrieb auf der Karte im Atlantik, mit Wetter
   * dazu.
   */
  test('vertauschte Achsen weisen die GANZE Datei ab', async () => {
    const vorher = await punkt()
    const b = await dateiEinlesen(ziel,
      'betrieb;breitengrad;laengengrad;herkunft\n'
      + 'Standort Testbetrieb;9.951000;49.793000;manuell')
    expect(b.fehler).not.toBeNull()
    expect(b.geschrieben).toBe(0)
    expect(await punkt()).toEqual(vorher)
  })

  test('eine halbe Koordinate ist keine', async () => {
    const b = await dateiEinlesen(ziel,
      'betrieb;breitengrad;herkunft\nStandort Testbetrieb;49.793000;manuell')
    expect(b.fehler).not.toBeNull()
    expect(b.geschrieben).toBe(0)
  })

  /** `herkunft` ist `NOT NULL` mit vier erlaubten Werten. Ohne die Spalte gäbe
   *  es einen Constraint-Fehler statt einer Meldung — deshalb ist sie Pflicht. */
  test('ohne herkunft wird die Datei abgewiesen und die Spalte genannt', async () => {
    const b = await dateiEinlesen(ziel, 'betrieb;plz;ort\nStandort Testbetrieb;97070;Würzburg')
    expect(b.fehler).toContain('herkunft')
    expect(b.geschrieben).toBe(0)
  })

  test('eine erfundene herkunft weist die Datei ab', async () => {
    const b = await dateiEinlesen(ziel,
      'betrieb;plz;ort;herkunft\nStandort Testbetrieb;97070;Würzburg;geschaetzt')
    expect(b.fehler).not.toBeNull()
    expect(b.geschrieben).toBe(0)
  })

  /**
   * Eine Adresse OHNE Koordinate ist erlaubt und nützlich: die PLZ allein
   * bringt schon das Bundesland und damit Feiertage und Schulferien.
   *
   * UND SIE LOESCHT DIE KOORDINATE NICHT, die schon dasteht — nachgemessen,
   * weil ich hier das Gegenteil erwartet hatte. Der Import schreibt nur die
   * Spalten, die in der Datei stehen („nur ergänzt und überschrieben, nie
   * gelöscht", pflege/README.md). Das ist die richtige Richtung: wer die
   * Adressen nachträgt, weil das Bundesland fehlt, darf damit nicht die
   * Wetterzuordnung der bereits gepflegten Betriebe wegwerfen.
   */
  test('eine Adresse ohne Koordinate ist erlaubt und loescht keine vorhandene', async () => {
    const vorher = await punkt()
    expect(vorher!.breitengrad).not.toBeNull()

    const b = await dateiEinlesen(ziel,
      'betrieb;plz;ort;herkunft\nStandort Testbetrieb;97070;Würzburg;concept_family')
    expect(b.fehler).toBeNull()
    expect(b.geschrieben).toBe(1)
    expect((await punkt())!.breitengrad).toBe(vorher!.breitengrad)
  })
})
