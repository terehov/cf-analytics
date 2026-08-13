/**
 * Tests für den Belegkorpus.
 *
 * Geprüft wird das, was ohne LINA prüfbar ist und wo ein Fehler teuer wäre:
 * die Erkennung der eingebetteten E-Rechnung (still falsch = ein Korpus ohne
 * Labels, und niemand merkt es), die Pfadfreigabe (ein Schreibpfad hier wäre
 * der teuerste Fehler des Projekts) und die Dateinamen (ein Zeichen zu viel,
 * und der Abzug bricht beim 1.400. Beleg ab).
 */
import { describe, expect, test } from 'bun:test'
import { deflateSync } from 'node:zlib'
import { erechnungXml, dateiname, ablage, nurLesend, type Beleg } from './korpus'
import { pfadPruefen, VerbotenerPfad } from './ladenakte/endpunkte'

/** Ein PDF-Gerüst mit einem Strom darin — mehr braucht der Sucher nicht. */
function pdfMitStrom(inhalt: Uint8Array | string, gepackt = true): Buffer {
  const roh = typeof inhalt === 'string' ? Buffer.from(inhalt, 'utf8') : Buffer.from(inhalt)
  const nutz = gepackt ? deflateSync(roh) : roh
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /EmbeddedFile /Filter /FlateDecode >>\nstream\n', 'latin1'),
    nutz,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ])
}

const ZUGFERD = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100">
  <rsm:SupplyChainTradeTransaction/>
</rsm:CrossIndustryInvoice>`

const XRECHNUNG = `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID>RE-2026-03839</cbc:ID>
</ubl:Invoice>`

describe('erechnungXml', () => {
  test('findet ZUGFeRD im gepackten Strom', () => {
    expect(erechnungXml(pdfMitStrom(ZUGFERD))).toContain('CrossIndustryInvoice')
  })

  test('findet XRechnung am UBL-Namensraum', () => {
    expect(erechnungXml(pdfMitStrom(XRECHNUNG))).toContain('RE-2026-03839')
  })

  /*
   * Nicht jedes PDF packt seine Anhänge. Ein unkomprimierter Strom ist selten,
   * aber er kostet hier nur einen zweiten Blick — und ein übersehener Anhang
   * fiele im Korpus als „PDF ohne Labels" nicht auf.
   */
  test('findet auch ungepacktes XML', () => {
    expect(erechnungXml(pdfMitStrom(ZUGFERD, false))).toContain('CrossIndustryInvoice')
  })

  /*
   * DER WICHTIGE FALL. Jedes zweite PDF trägt XMP-Metadaten — XML, aber nicht
   * die Rechnung. Wer nur auf "<?xml" prüft, hält 300.000 Scans für
   * E-Rechnungen und merkt es erst in der Pipeline.
   */
  test('hält XMP-Metadaten nicht für eine Rechnung', () => {
    const xmp = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>`
    expect(erechnungXml(pdfMitStrom(xmp))).toBeNull()
  })

  test('ein gewöhnlicher Scan liefert null', () => {
    expect(erechnungXml(pdfMitStrom('nur Bilddaten, kein XML'))).toBeNull()
  })

  test('bricht an einem abgeschnittenen Strom nicht ab', () => {
    const kaputt = Buffer.from('%PDF-1.7\nstream\nnoch mittendrin', 'latin1')
    expect(erechnungXml(kaputt)).toBeNull()
  })
})

describe('Ablage', () => {
  const b = {
    lina_id: 4711, encrypted_id: 'x', typ_id: '1', belegart: 'Eingangsrechnungen und Avise',
    lina_betrieb_id: 62, datei_name: 'CWS 104,58€ Mai/2026_5008312623_zugferd',
  } as unknown as Beleg

  test('Dateiname trägt die lina_id vorn und keine Pfadzeichen', () => {
    const n = dateiname(b)
    expect(n.startsWith('4711__')).toBe(true)
    expect(n.endsWith('.pdf')).toBe(true)
    expect(n).not.toContain('/')
  })

  /*
   * Ein Beleg ohne Dateinamen ist im Bestand selten, aber vorhanden (drei von
   * 394.814 Eingangsrechnungen). Ein leerer Name ergäbe "4711__.pdf" — der
   * Wiederaufnahme-Test "liegt schon da" träfe dann auf einen Namen, den
   * mehrere Belege teilen könnten.
   */
  test('ohne Dateinamen bleibt der Name eindeutig', () => {
    const n = dateiname({ ...b, datei_name: null } as Beleg)
    expect(n).toBe('4711__ohne_namen.pdf')
  })

  test('Ordner trennt nach Belegart und Betrieb', () => {
    expect(ablage('/korpus', b)).toBe('/korpus/eingangsrechnungen_und_avise/62')
  })
})

describe('Sicherungen', () => {
  test('getBeleg ist freigegeben', () => {
    expect(() => pfadPruefen('/intranet/ladenakte/getBeleg')).not.toThrow()
  })

  /*
   * Die Freigabe gilt genau diesem Pfad. Alles, was daran anschließt, ist ein
   * anderer Endpunkt — und der ist gesperrt, auch wenn er harmlos aussieht.
   */
  test('was an getBeleg anschließt, bleibt gesperrt', () => {
    expect(() => pfadPruefen('/intranet/ladenakte/getBeleg/delete/1')).toThrow(VerbotenerPfad)
    expect(() => pfadPruefen('/intranet/ladenakte/getBelegUpload')).toThrow(VerbotenerPfad)
  })

  test('die Auswahl darf nichts schreiben', () => {
    expect(() => nurLesend('SELECT 1')).not.toThrow()
    expect(() => nurLesend('WITH a AS (SELECT 1) SELECT * FROM a')).not.toThrow()
    expect(() => nurLesend('UPDATE core.buchungsbeleg SET netto = 0')).toThrow()
    expect(() => nurLesend('SELECT 1; DROP TABLE core.buchungsbeleg')).toThrow()
  })
})
