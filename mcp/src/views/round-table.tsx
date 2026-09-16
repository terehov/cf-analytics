/**
 * Das Ampelraster.
 *
 * DIE EINE ANSICHT, DIE TEXT NICHT KANN. Der Round Table ist ein Raster aus
 * rot, orange und gruen; als Aufzaehlung im Chat ist er unlesbar, als
 * Farbraster ist er das Produkt. Genau dafuer gibt es die Ansichten
 * ueberhaupt.
 *
 * DIE FARBEN WERDEN NICHT NEU ERFUNDEN. Sie kommen aus den Ampelwerten der
 * Daten (ampel.regelwerk), nicht aus einer Schwelle in dieser Datei — eine
 * zweite Schwellenlogik in der Oberflaeche waere eine zweite Wahrheit ueber
 * dieselbe Bewertung.
 *
 * WELCHE SPALTEN AMPELN SIND, SAGT DER SERVER. `spalten_info` traegt je
 * Spalte die Rolle (spalten_info.ts) — dieselbe Auskunft, nach der das
 * Modell seine Darstellung waehlt. Bis zum 16.09.2026 suchte diese Datei
 * stattdessen nach Spalten NAMENS "ampel" oder "gesamt" mit den WOERTERN
 * rot/orange/gruen. Die Karte (metabase/karten-drilldown.ts,
 * dd_filialen_tabelle) liefert aber Spalten namens "●" und "◐ Umsatz" mit
 * den EMOJIS aus ampel.beschriftung — kein Treffer, kein Farbraster, nur
 * Emojis als Text. Der Namensfilter bleibt als Rueckfall fuer Antworten
 * ohne spalten_info.
 */
import { useToolInfo } from '../helpers'

type Ampel = { farbe: string; schrift: string; text: string }

/**
 * Status → Darstellung. Die Woerter kommen aus mart.round_table_monat
 * (rot, orange, gruen, unvollstaendig), die Emojis aus ampel.beschriftung
 * (🔴 🟠 🟢) und dem coalesce der Karte (⚪ = keine Ampel berechenbar).
 */
const AMPEL: Record<string, Ampel> = {
  rot:            { farbe: '#c82828', schrift: '#fff', text: 'rot' },
  '🔴':           { farbe: '#c82828', schrift: '#fff', text: 'rot' },
  orange:         { farbe: '#d28c00', schrift: '#fff', text: 'orange' },
  gelb:           { farbe: '#d28c00', schrift: '#fff', text: 'orange' },
  '🟠':           { farbe: '#d28c00', schrift: '#fff', text: 'orange' },
  '🟡':           { farbe: '#d28c00', schrift: '#fff', text: 'orange' },
  gruen:          { farbe: '#2e8b57', schrift: '#fff', text: 'grün' },
  'grün':         { farbe: '#2e8b57', schrift: '#fff', text: 'grün' },
  '🟢':           { farbe: '#2e8b57', schrift: '#fff', text: 'grün' },
  grau:           { farbe: 'rgba(128,128,128,.25)', schrift: 'inherit', text: 'ohne' },
  '⚪':           { farbe: 'rgba(128,128,128,.25)', schrift: 'inherit', text: 'ohne' },
  unvollstaendig: { farbe: 'rgba(128,128,128,.25)', schrift: 'inherit', text: 'unvollständig' },
}

export function ampelAus(wert: unknown): Ampel | undefined {
  if (wert === null || wert === undefined) return undefined
  return AMPEL[String(wert).trim().toLowerCase()]
}

/** Die Ampelspalten: aus spalten_info, sonst (Rueckfall) nach dem Namen. */
export function ampelSpalten(
  spalten: string[], info: { spalte: string; rolle: string }[] | undefined,
): Set<string> {
  const ausInfo = (info ?? []).filter(i => i.rolle === 'ampel').map(i => i.spalte)
  if (ausInfo.length) return new Set(ausInfo)
  return new Set(spalten.filter(s => /ampel|gesamt/i.test(s)))
}

export default function RoundTable() {
  const zustand = useToolInfo<'round_table'>()
  if (zustand.isPending) return <p style={{ padding: 12, font: '13px system-ui' }}>Wird geholt …</p>
  const { output } = zustand

  const spalten = output.spalten ?? []
  const zeilen = output.zeilen ?? []
  const ampeln = ampelSpalten(spalten, output.spalten_info as { spalte: string; rolle: string }[] | undefined)

  return (
    <div style={{ font: '13px/1.5 system-ui, sans-serif' }}>
      {(output.datenstand as any) && (
        <p style={{ fontSize: 12, opacity: .7 }}>
          Datenstand: Umsatz bis {(output.datenstand as any).umsatz_bis ?? '—'},
          {' '}BWA bis {(output.datenstand as any).bwa_bis ?? '—'} — der BWA-Monat ist je Betrieb
          {' '}ein anderer.
        </p>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(128,128,128,.25)', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
          <thead>
            <tr>{spalten.map(s => (
              <th key={s} style={{ textAlign: 'left', padding: '6px 10px', whiteSpace: 'nowrap',
                                   borderBottom: '1px solid rgba(128,128,128,.3)' }}>{s}</th>
            ))}</tr>
          </thead>
          <tbody>
            {zeilen.map((z: any, i: number) => (
              <tr key={i}>
                {spalten.map(s => {
                  const wert = z[s]
                  const ampel = ampeln.has(s) ? ampelAus(wert) : undefined
                  if (ampel) {
                    return (
                      <td key={s} data-ampel={ampel.text}
                          style={{ padding: '5px 10px', whiteSpace: 'nowrap', textAlign: 'center',
                                   background: ampel.farbe, color: ampel.schrift, fontWeight: 600 }}>
                        {ampel.text}
                      </td>
                    )
                  }
                  return (
                    <td key={s} style={{ padding: '5px 10px', whiteSpace: 'nowrap',
                                         textAlign: typeof wert === 'number' ? 'right' : 'left',
                                         fontVariantNumeric: 'tabular-nums' }}>
                      {wert === null || wert === undefined ? '—'
                        : typeof wert === 'number' ? wert.toLocaleString('de-DE') : String(wert)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, opacity: .7, marginTop: 6 }}>
        {output.zeilen_gesamt} Betrieb(e). Ampeln zaehlen, nicht mitteln — der Mittelwert zweier
        Ampeln ist keine Ampel.
      </p>
    </div>
  )
}
