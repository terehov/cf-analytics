/**
 * Sieht der IMPORTER-Zugang die Bestellansicht? (0135, 19.10.2026)
 *
 *   bun run bestellansicht-probe
 *
 * Der Ersatzweg `fn:bestellansicht` ist im Browser mit dem Admin-Zugang
 * gemessen. Der Nachtlauf meldet sich aber mit FN_ENCHILADA_USER an — ob diese
 * Sitzung die serverseitig gerenderte Seite /shop/{shopId}/orders/{nr} sehen
 * darf, sagt nur ein Aufruf mit genau diesem Zugang.
 *
 * DREI AUFRUFE, NUR GET, KEINE DATENBANK, NICHTS GESPEICHERT:
 *   1. /api/10262/shop-order/638090         Bestellkopf (Nummer 451) — liefert
 *                                           ansicht_nr und Artikelzahl
 *   2. /api/10262/shop-order/638090/change  der Abruf, der scheitert — Gegenprobe,
 *                                           dass das Problem noch besteht
 *   3. /shop/6421/orders/{ansicht_nr}        die Ansicht, ueber denselben FnClient
 *                                           und denselben Parser wie im Sync
 *
 * ANMELDUNG wie im Importer (FnClient/FnSession), ein Versuch, keine
 * Wiederholung bei einem Anmeldefehler. Nur im Terminal des Nutzers starten —
 * dieselbe Vorsicht wie bei rezepte-probe (docs/importer.md).
 *
 * WAS DIE ANTWORT HEISST — steht vor dem Aufruf fest:
 *   Exit 0  Seite gelesen, Zeilenzahl = Artikelzahl des Kopfs  → der Ersatzweg traegt
 *   Exit 1  Seite kam, aber Parser oder Zeilenzahl passen nicht → Markup/Zugang pruefen
 *   Exit 2  Seite kam nicht (HTTP-Fehler, Umleitung zur Anmeldung) → der Zugang darf die
 *           Oberflaeche nicht sehen; der Ersatzweg wuerde nachts scheitern
 *   Exit 3  Anmeldung oder Bestellkopf gescheitert → nichts ueber die Ansicht gelernt
 */
import { FnClient } from './foodnotify/client'
import { fnEndpunkt } from './foodnotify/endpunkte'
import { bestellkopf } from './foodnotify/transform'
import { bestellansichtLesen } from './foodnotify/bestellansicht'

const MARKE = 'enchilada'
const ERP_ID = '10262'
const ORDER_ID = '638090'

async function main(): Promise<number> {
  const client = new FnClient()
  console.log(`Marke ${MARKE}, Kostenstelle ${ERP_ID}, Bestellung ${ORDER_ID} (Nummer 451)\n`)

  const kopfRes = await client.holen(fnEndpunkt('fn:bestellung'), MARKE, { erpId: ERP_ID, orderId: ORDER_ID })
  if (kopfRes.art !== 'ok') {
    console.log(`1. Bestellkopf: ${kopfRes.art} — ${'fehler' in kopfRes ? kopfRes.fehler : ''}`)
    return 3
  }
  const kopf = bestellkopf(kopfRes.daten)
  console.log(`1. Bestellkopf: ok — Ansichtsnummer ${kopf.ansichtNr}, ${kopf.artikelAnzahl} Artikel, `
    + `Lieferant ${kopf.lieferant?.name} (${kopf.lieferant?.fnId})`)
  if (!kopf.ansichtNr || !kopf.lieferant || kopf.artikelAnzahl === null) {
    console.log('   Kopf ohne Ansichtsnummer, Lieferant oder Artikelzahl — die Ansicht ist nicht adressierbar.')
    return 3
  }

  const changeRes = await client.holen(fnEndpunkt('fn:bestellpositionen'), MARKE, { erpId: ERP_ID, orderId: ORDER_ID })
  console.log(`2. Positionsabruf /change: ${changeRes.art}${'fehler' in changeRes ? ` — ${changeRes.fehler}` : ''}`
    + (changeRes.art === 'ok' ? '  ← die Schnittstelle liefert wieder; der Ersatzweg wird fuer diese Bestellung nicht gebraucht' : ''))

  const ansichtRes = await client.holen(fnEndpunkt('fn:bestellansicht'), MARKE,
    { erpId: ERP_ID, orderId: ORDER_ID, shopId: kopf.lieferant.fnId, ansichtNr: kopf.ansichtNr })
  if (ansichtRes.art !== 'ok') {
    console.log(`3. Bestellansicht /shop/${kopf.lieferant.fnId}/orders/${kopf.ansichtNr}: ${ansichtRes.art} — `
      + `${'fehler' in ansichtRes ? ansichtRes.fehler : ''}`)
    console.log('\n→ Der Importer-Zugang sieht die Ansicht NICHT. Der Ersatzweg wuerde nachts scheitern.')
    return 2
  }
  try {
    const a = bestellansichtLesen(String(ansichtRes.daten))
    const passt = a.positionen.length === kopf.artikelAnzahl
    console.log(`3. Bestellansicht: ok — ${a.positionen.length} Zeilen (Kopf: ${kopf.artikelAnzahl}), `
      + `Oberflaechennummer ${a.ansichtNr}, Seitensumme brutto ${a.gesamtsumme}`)
    for (const p of a.positionen.slice(0, 3)) {
      console.log(`   ${p.lieferantenNr?.padEnd(8)} ${String(p.menge).padStart(4)} x ${String(p.gebindeMenge).padStart(4)} ${p.gebindeEinheit?.padEnd(4)} ${p.summe.toFixed(2).padStart(9)}  ${p.name}`)
    }
    console.log(passt
      ? '\n→ Der Ersatzweg traegt: der Importer-Zugang sieht die Ansicht, und sie ist vollstaendig.'
      : '\n→ Zeilenzahl passt nicht zum Kopf — der Lader wuerde nichts laden. Markup pruefen.')
    return passt ? 0 : 1
  } catch (e) {
    console.log(`3. Bestellansicht kam, aber der Parser wirft: ${String(e)}`)
    console.log('   (Eine Anmeldeseite statt der Bestellung sieht genau so aus.)')
    return 1
  }
}

process.exit(await main())
