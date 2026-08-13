import { describe, expect, test } from 'bun:test'
import { inventurListe, inventurpositionen } from './inventur'

/**
 * Die payload-Hülle wird nur als Hülle ERKANNT, wenn neben `payload`
 * mindestens eines von `isError`/`errors`/`code` steht (huelle.ts,
 * `istPayloadHuelle`) — ein bloßes `{payload: {...}}` bleibt sonst
 * UNAUSGEPACKT stehen und `auspacken()` liefert am Ende ein Objekt statt
 * einer Liste. Diese Hilfsfunktion hält das in jedem Testfixture konstant,
 * statt es in jedem Testfall neu zu vergessen.
 */
const huelle = (payload: unknown) => ({ errors: [], code: 200, isError: false, payload })

describe('inventurListe (/api/erp/stocktakings)', () => {
  const seite1 = huelle({
    data: [
      { id: 'inv-1', erpId: 10483, name: 'Kücheninventur Juli', type: 'full',
        createdAt: '2026-07-01T08:00:00+00:00', timeModified: '2026-07-01T10:00:00+00:00',
        status: { name: 'signed' }, totalNumberOfItems: 2, note: null },
    ],
    pagination: { currentPage: 1, totalPages: 2, totalItems: 2 },
  })

  test('liest Kopf, Kostenstelle und Seiten aus der geschachtelten payload→data-Hülle', () => {
    const s = inventurListe(seite1)
    expect(s.aktuelleSeite).toBe(1)
    expect(s.gesamtSeiten).toBe(2)
    expect(s.gesamt).toBe(2)
    expect(s.inventuren).toEqual([{
      fnUuid: 'inv-1', erpId: 10483, name: 'Kücheninventur Juli', art: 'full',
      status: 'signed', anzahlPositionen: 2, notiz: null,
      erstelltAm: '2026-07-01T08:00:00.000Z', geaendertAm: '2026-07-01T10:00:00.000Z',
    }])
  })

  /**
   * DER STATUS IST EIN OBJEKT — genau dieselbe Falle wie bei
   * shopOrderStatus (0043). `type` ist ungemessen und läuft deshalb
   * vorsorglich durch dieselbe Behandlung: eine plausibel aussehende
   * Zeichenkette darf sich als Objekt entpuppen, ohne dass daraus
   * "[object Object]" wird.
   */
  test('status und art werden aus {name} gelesen, nie zu [object Object]', () => {
    const s = inventurListe(huelle({ data: [
      { id: 'x', erpId: 1, type: { name: 'full' }, status: { name: 'counting' } },
    ] }))
    expect(s.inventuren[0]!.art).toBe('full')
    expect(s.inventuren[0]!.status).toBe('counting')
  })

  test('eine flache Zeichenkette bleibt für status und art erlaubt', () => {
    const s = inventurListe(huelle({ data: [
      { id: 'x', erpId: 1, type: 'full', status: 'signed' },
    ] }))
    expect(s.inventuren[0]!.art).toBe('full')
    expect(s.inventuren[0]!.status).toBe('signed')
  })

  test('ohne id oder ohne erpId fällt die Zeile heraus, statt zu werfen', () => {
    const s = inventurListe(huelle({ data: [
      { id: null, erpId: 1 },
      { id: 'ohne-erp', erpId: null },
      { id: 'gut', erpId: 2 },
    ] }))
    expect(s.inventuren).toHaveLength(1)
    expect(s.inventuren[0]!.fnUuid).toBe('gut')
  })

  test('leere Seite: keine Inventuren, Seitenzähler bleiben verlässlich', () => {
    const s = inventurListe(huelle({
      data: [], pagination: { currentPage: 2, totalPages: 2, totalItems: 2 },
    }))
    expect(s.inventuren).toEqual([])
    expect(s.aktuelleSeite).toBe(2)
  })
})

describe('inventurpositionen (/{uuid}/items)', () => {
  /** Das Beispiel aus docs/foodnotify-api-inventar.md §4, wörtlich. */
  const antwort = huelle([
    { id: '019fba58-000', name: 'Granini Orangensaft Mw 6X1,00',
      shopArticleId: '460614', shopName: 'HFS Getränke', baseUnit: 'ml',
      theoreticalStockLevelInBaseUnits: 29612.59, countedAmountInBaseUnits: 6000,
      reviewAmountInBaseUnits: 6000, pricePerBaseUnit: 0.0025533 },
  ])

  test('Sollbestand, gezählte Menge, Nachzählung und Preis je Basiseinheit', () => {
    const p = inventurpositionen(antwort)
    expect(p.positionen).toHaveLength(1)
    expect(p.positionen[0]).toEqual({
      fnId: '019fba58-000', name: 'Granini Orangensaft Mw 6X1,00',
      shopName: 'HFS Getränke', basisEinheit: 'ml',
      sollMenge: 29612.59, gezaehlteMenge: 6000, nachzaehlungMenge: 6000,
      preisJeBasiseinheit: 0.0025533, lieferantenNr: '460614',
    })
  })

  test('ohne shopArticleId bleibt lieferantenNr null — kein erfundener Schlüssel', () => {
    const ohne = huelle([{ ...(antwort.payload as any[])[0], shopArticleId: null }])
    expect(inventurpositionen(ohne).positionen[0]!.lieferantenNr).toBeNull()
  })

  test('eine Zeile ohne name ist keine Position', () => {
    const kaputt = huelle([{ id: 'x' }])
    expect(inventurpositionen(kaputt).positionen).toEqual([])
  })

  test('reviewAmountInBaseUnits fehlt oft — dann null, nicht 0', () => {
    const ohneNachzaehlung = huelle([{ ...(antwort.payload as any[])[0], reviewAmountInBaseUnits: null }])
    expect(inventurpositionen(ohneNachzaehlung).positionen[0]!.nachzaehlungMenge).toBeNull()
  })

  /**
   * DER 800er-ABSCHNITT — der Fehler, der bis zum 13.08.2026 lief.
   *
   * Die Hülle ist WÖRTLICH die aus Produktion: `{data, pagination}` OHNE
   * payload-Umschlag, am Rohbestand aller 358 Antworten geprüft. Die
   * Zahlen stammen aus der Inventur 019ca7da (02.2026): perPage 800,
   * totalItems 817, totalPages 2 — und 800 geladene Positionen.
   *
   * Solange dieser Test steht, kann die Seitenangabe nicht noch einmal
   * still verlorengehen: sie wurde von `auspacken()` immer korrekt
   * gelesen, nur vom Rückgabewert weggeworfen.
   */
  test('die Seitenangabe kommt mit zurück — sonst endet eine Inventur lautlos bei 800', () => {
    const echt = {
      data: [{ id: 'p1', name: 'Kartoffel', shopArticleId: '1' }],
      pagination: { perPage: 800, totalItems: 817, totalPages: 2, currentPage: 1 },
    }
    const p = inventurpositionen(echt)
    expect(p.aktuelleSeite).toBe(1)
    expect(p.gesamtSeiten).toBe(2)
    expect(p.gesamt).toBe(817)
    expect(p.positionen).toHaveLength(1)
  })

  test('Seite 2 meldet sich als Seite 2 — daran hängt, dass Seite 1 nicht gelöscht wird', () => {
    const zweite = {
      data: [{ id: 'p801', name: 'Zwiebel', shopArticleId: '2' }],
      pagination: { perPage: 800, totalItems: 817, totalPages: 2, currentPage: 2 },
    }
    expect(inventurpositionen(zweite).aktuelleSeite).toBe(2)
  })

  test('ohne pagination ist es eine einzige Seite, nicht null Seiten', () => {
    const p = inventurpositionen(antwort)
    expect(p.aktuelleSeite).toBe(1)
    expect(p.gesamtSeiten).toBe(1)
  })
})
