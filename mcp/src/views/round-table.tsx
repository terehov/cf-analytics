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
 */
import { useToolInfo } from '../helpers'

const FARBE: Record<string, string> = {
  rot: '#c82828', orange: '#d28c00', gruen: '#2e8b57', grün: '#2e8b57', grau: '#9a9a9a',
}

export default function RoundTable() {
  const zustand = useToolInfo<'round_table'>()
  if (zustand.isPending) return <p style={{ padding: 12, font: '13px system-ui' }}>Wird geholt …</p>
  const { output } = zustand

  const spalten = output.spalten ?? []
  const zeilen = output.zeilen ?? []
  const ampelSpalten = spalten.filter(s => /ampel|gesamt/i.test(s))

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
                  const farbe = ampelSpalten.includes(s) ? FARBE[String(wert).toLowerCase()] : undefined
                  return (
                    <td key={s} style={{ padding: '5px 10px', whiteSpace: 'nowrap',
                                         textAlign: typeof wert === 'number' ? 'right' : 'left',
                                         fontVariantNumeric: 'tabular-nums',
                                         ...(farbe ? { background: farbe, color: '#fff', fontWeight: 600 } : {}) }}>
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
