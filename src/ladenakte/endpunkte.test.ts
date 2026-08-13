/**
 * Registertest der Ladenakte — ohne Datenbank, ohne Netz.
 *
 * Der wichtigste Test hier ist nicht der auf die Endpunkte, sondern der auf
 * die Loeschsperre: in der Ladenakte ist Loeschen ein GET-Link.
 */
import { describe, expect, test } from 'bun:test'
import {
  LADENAKTE_ENDPUNKTE, LADENAKTE_KEYS, FIBU_BELEGARTEN, SEITENGROESSE, ZAEHLGROESSE,
  BAUM, ORDNERSEITE, pfadPruefen, VerbotenerPfad, VERBOTENE_SEGMENTE, istLadenakte,
} from './endpunkte'
import { ENDPUNKTE } from '../lina/endpunkte'

describe('Loeschsperre', () => {
  /**
   * Der Ernstfall, wortwoertlich aus der Erhebung: so sieht der Link aus, der
   * einen Vertrag loescht. Er ist ein <a href>, kein Formular.
   */
  test('der echte Loeschpfad aus der Vertraege-Seite wird abgewiesen', () => {
    expect(() => pfadPruefen('/intranet/ladenakte/vertraege/laden/abc123/vertragid/7/delete/1'))
      .toThrow(VerbotenerPfad)
  })

  test('auch die schreibenden Stammdaten-Pfade', () => {
    for (const p of [
      '/intranet/ladenakte/vertragedit/laden/abc',
      '/intranet/ladenakte/apikeyadd',
      '/intranet/ladenakte/apikeydelete',
      '/intranet/ladenakte/setStoreHeadquarter/1',
      '/intranet/ladenakte/uploadbudget',
      '/intranet/ladenakte/addgesell',
    ]) {
      expect(() => pfadPruefen(p)).toThrow(VerbotenerPfad)
    }
  })

  /**
   * Der Fall, an dem die urspruengliche Sperrliste gescheitert ist: als ganzes
   * Segment ist "vertragEdit" ungleich "edit". Die Positivliste faengt ihn,
   * ohne ihn zu kennen — er steht schlicht nicht drauf.
   */
  test('vertragEdit — der Fall, der eine Sperrliste unterlaufen haette', () => {
    expect(() => pfadPruefen('/intranet/ladenakte/vertragEdit/laden/abc')).toThrow(VerbotenerPfad)
  })

  test('auch alles, was LINA morgen dazubaut, ist gesperrt', () => {
    for (const p of [
      '/intranet/ladenakte/irgendwasNeues',
      '/intranet/ladenakte/vertraege/laden/abc/admin/1/',
      '/finanzen/bwa/auswertung',
      '/intranet/report/buhaexport/laden/abc/admin/1/',
    ]) {
      expect(() => pfadPruefen(p)).toThrow(VerbotenerPfad)
    }
  })

  test('Query-Teil wird nicht mitgeprueft, aber auch nicht zum Schlupfloch', () => {
    expect(() => pfadPruefen('/intranet/ladenakte/beleglist?typeId=1&mode=delete')).not.toThrow()
    expect(() => pfadPruefen('/intranet/ladenakte/delete?harmlos=1')).toThrow(VerbotenerPfad)
  })

  test('das Stammdatenblatt mit Laden-Hash kommt durch, mit Unsinn darin nicht', () => {
    const hash = 'a'.repeat(40)
    expect(() => pfadPruefen(`/intranet/ladenakte/ladenstamm/laden/${hash}/admin/1/`)).not.toThrow()
    expect(() => pfadPruefen('/intranet/ladenakte/ladenstamm/laden/../../etc/admin/1/'))
      .toThrow(VerbotenerPfad)
  })

  /**
   * Der Unfall des ersten Laufs, 12.08.2026: drei von 131 Stammdatenblaettern
   * wurden von dieser Sperre abgewiesen, weil ihr Laden-Hash die Zeichenfolge
   * `add` enthielt. `add` besteht ausschliesslich aus Hexziffern, und verglichen
   * wurde damals mit `includes()` statt auf Gleichheit. In einem 85-stelligen
   * Hexstring tritt die Folge mit rund zwei Prozent Wahrscheinlichkeit auf — bei
   * 131 Betrieben rechnerisch dreimal. Genau dreimal ist es passiert.
   *
   * Die echten Hashes stehen hier nicht (AGENTS.md Regel 2). Nachgebaut ist nur,
   * worauf es ankommt.
   */
  test('ein Laden-Hash mit der Hexfolge "add" ist kein Schreibpfad', () => {
    const hash = '0'.repeat(20) + 'add' + 'c0ffee'.repeat(10) + '00'
    expect(hash).toMatch(/^[0-9a-f]{20,120}$/)
    expect(() => pfadPruefen(`/intranet/ladenakte/ladenstamm/laden/${hash}/admin/1/`)).not.toThrow()
  })

  /**
   * Dieselbe Falle fuer jedes kuenftige Verbotswort, das zufaellig aus Hexziffern
   * besteht — `dead`, `beef`, `face` waeren die naechsten Kandidaten. Wer eines
   * hinzufuegt, bekommt hier sofort einen roten Test statt in acht Monaten drei
   * fehlende Betriebe.
   */
  test('geprueft wird das ganze Segment, nicht ein Stueck davon', () => {
    const hexWoerter = VERBOTENE_SEGMENTE.filter(w => /^[0-9a-f]+$/.test(w))
    expect(hexWoerter).toContain('add')
    for (const wort of hexWoerter) {
      const hash = 'ab'.repeat(15) + wort + 'cd'.repeat(15)
      expect(() => pfadPruefen(`/intranet/ladenakte/ladenstamm/laden/${hash}/admin/1/`)).not.toThrow()
    }
  })

  test('ein Segment, das GENAU ein Schreibwort ist, faellt weiterhin durch', () => {
    for (const w of ['delete', 'edit', 'add', 'new', 'save']) {
      expect(() => pfadPruefen(`/intranet/ladenakte/${w}`)).toThrow(VerbotenerPfad)
    }
  })

  test('alle tatsaechlich benutzten Pfade kommen durch die Sperre', () => {
    for (const ep of [...LADENAKTE_ENDPUNKTE, BAUM, ORDNERSEITE]) {
      expect(() => pfadPruefen(ep.pfad)).not.toThrow()
    }
  })

  test('die Sperrliste ist nicht versehentlich leer', () => {
    expect(VERBOTENE_SEGMENTE.length).toBeGreaterThan(5)
    expect(VERBOTENE_SEGMENTE).toContain('delete')
  })
})

describe('Register', () => {
  test('vier Endpunkte, alle mit la:-Praefix und alle inaktiv', () => {
    expect(LADENAKTE_ENDPUNKTE.length).toBe(4)
    for (const ep of LADENAKTE_ENDPUNKTE) {
      expect(ep.key.startsWith('la:')).toBe(true)
      expect(istLadenakte(ep.key)).toBe(true)
      /**
       * aktiv:false ist kein Versehen. AKTIVE_ENDPUNKTE speist einreihen() und
       * nachfuellen(); auf Betriebsebene waeren das 131 Posten je Zeitraum,
       * eingereiht von etwas, das niemand ausgeloest hat. Eingereiht wird
       * ausschliesslich von ladenakteNachfuellen().
       */
      expect(ep.aktiv).toBe(false)
    }
  })

  test('die geprueften Schluessel existieren wirklich', () => {
    // Sonst prueft der Test darueber einen Tippfehler statt eines Endpunkts.
    for (const key of ['la:belegzahl', 'la:belegliste', 'la:bwa_longterm', 'la:stammdaten']) {
      expect(LADENAKTE_KEYS.has(key)).toBe(true)
    }
  })

  test('keine Kollision mit dem bestehenden LINA-Register', () => {
    const bestehend = new Set(ENDPUNKTE.map(e => e.key))
    for (const ep of [...LADENAKTE_ENDPUNKTE, BAUM, ORDNERSEITE]) {
      expect(bestehend.has(ep.key)).toBe(false)
    }
  })

  test('Antwortform ist ueberall gesetzt — nichts wird am Content-Type geraten', () => {
    const form = Object.fromEntries([...LADENAKTE_ENDPUNKTE, BAUM, ORDNERSEITE]
      .map(e => [e.key, e.form]))
    expect(form).toEqual({
      'la:belegzahl': 'json',
      'la:belegliste': 'json',
      'la:bwa_longterm': 'html',
      'la:stammdaten': 'html',
      // Der Baum liefert JSON und deklariert text/html. Genau deshalb steht es hier.
      'la:baum': 'json',
      'la:ordnerseite': 'html',
    })
  })
})

describe('Parameter', () => {
  const ep = LADENAKTE_ENDPUNKTE.find(e => e.key === 'la:belegliste')!

  test('holt den ganzen Ordner statt zu blaettern', () => {
    const p = ep.parameter('2026-08-01', '2026-08-01', { storeId: 'tok', typeId: '1' })
    expect(p.length).toBe(String(SEITENGROESSE))
    expect(p.start).toBe('0')
    expect(SEITENGROESSE).toBeGreaterThan(12_639 * 2)   // groesster gemessener Ordner
  })

  test('sortiert aufsteigend nach LINA-Beleg-ID', () => {
    const p = ep.parameter('2026-08-01', '2026-08-01', {})
    // Aufsteigend, damit waehrend des Laufs neu hochgeladene Belege am Ende
    // landen und das Raster nicht verschieben.
    expect(p['order[0][column]']).toBe('0')
    expect(p['order[0][dir]']).toBe('asc')
  })

  test('extra ueberschreibt, damit Betrieb und Ordner von aussen kommen', () => {
    const p = ep.parameter('2026-08-01', '2026-08-01', { typeId: '3974', storeId: 'xyz' })
    expect(p.typeId).toBe('3974')
    expect(p.storeId).toBe('xyz')
  })
})

/**
 * DIE ZAEHLUNG — der Endpunkt, aus dem seit dem 13.08.2026 der Zulauf entsteht.
 *
 * Was diese Tests festhalten, ist nicht Kosmetik, sondern die Rechnung, die den
 * taeglichen Abgleich ueberhaupt bezahlbar macht: 1.834 Zaehlungen am Tag gehen
 * nur, solange eine Zaehlung eine Zeile holt. Wer hier length hochsetzt, holt
 * versehentlich 131 x 14 volle Ordner — im Erstabzug waren das acht Stunden und
 * mehrere hundert Megabyte, und das Tagesbudget von 10.500 waere gerissen.
 */
describe('Zaehlung', () => {
  const zahl = LADENAKTE_ENDPUNKTE.find(e => e.key === 'la:belegzahl')!
  const liste = LADENAKTE_ENDPUNKTE.find(e => e.key === 'la:belegliste')!

  test('holt EINE Zeile — daran haengt, dass 1.834 Aufrufe am Tag tragbar sind', () => {
    const p = zahl.parameter('2026-08-13', '2026-08-13', { storeId: 'tok', typeId: '1' })
    expect(p.length).toBe(String(ZAEHLGROESSE))
    expect(ZAEHLGROESSE).toBe(1)
    expect(p.start).toBe('0')
  })

  /**
   * Nicht 0: DataTables deutet length=0 je nach Fassung als "keine Begrenzung"
   * und liefert dann den ganzen Ordner — genau das, was die Zaehlung vermeidet.
   */
  test('nicht null Zeilen, sondern eine — null hiesse bei DataTables "alle"', () => {
    expect(ZAEHLGROESSE).toBeGreaterThan(0)
  })

  test('derselbe Pfad und derselbe Token wie der volle Abzug', () => {
    expect(zahl.pfad).toBe(liste.pfad)
    expect(zahl.braucht).toBe('beleg_token')
    expect(zahl.ebene).toBe('betrieb')
  })

  test('dieselbe Sortierung wie der Abzug — sonst zaehlt sie etwas anderes', () => {
    const p = zahl.parameter('2026-08-13', '2026-08-13', {})
    expect(p['order[0][column]']).toBe('0')
    expect(p['order[0][dir]']).toBe('asc')
  })

  test('Betrieb und Ordner kommen von aussen', () => {
    const p = zahl.parameter('2026-08-13', '2026-08-13', { typeId: '3969', storeId: 'xyz' })
    expect(p.typeId).toBe('3969')
    expect(p.storeId).toBe('xyz')
  })

  test('der Pfad der Zaehlung kommt durch die Loeschsperre', () => {
    expect(() => pfadPruefen(zahl.pfad)).not.toThrow()
  })
})

describe('Belegarten', () => {
  test('vierzehn FiBu-Arten', () => {
    expect(FIBU_BELEGARTEN.length).toBe(14)
    expect(new Set(FIBU_BELEGARTEN.map(b => b.typId)).size).toBe(14)
  })

  /**
   * Die Positivliste ist der ganze Schutz. Stuende hier eine Ausschlussliste,
   * griffe der Importer bei der naechsten neuen Lohn-Belegart stillschweigend zu.
   */
  test('kein einziger Lohn-Zweig darunter', () => {
    const lohn = ['9', '10', '11', '12', '13', '14', '15', '3958', '3959', '3960',
                  '3961', '3962', '3963', '3964', '3965', '3966', '3978', '3979',
                  '3980', '3981', '3982', '3983', '3984', '3985', '3986', '3989',
                  '4001', '4002', '4003', '4004']
    for (const b of FIBU_BELEGARTEN) expect(lohn).not.toContain(b.typId)
  })

  test('die acht gezaehlten Arten sind dabei — und die sechs ungezaehlten auch', () => {
    const ids = FIBU_BELEGARTEN.map(b => b.typId)
    for (const g of ['1', '2', '3', '5', '3970', '3974', '3975', '3977']) expect(ids).toContain(g)
    // Diese sechs waren am 11.08.2026 NICHT gezaehlt — 593.314 ist deshalb eine
    // Untergrenze. Geholt werden sie trotzdem.
    for (const u of ['16', '3968', '3969', '3971', '3972', '3976']) expect(ids).toContain(u)
  })
})
