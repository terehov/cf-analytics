/**
 * Die Ergebnistabelle — von mehreren Ansichten benutzt.
 *
 * WARUM SIE NICHT IN views/ LIEGT: Skybridge laesst jede Ansicht genau ein
 * Werkzeug bedienen (`view "x" is already used by tool "y"`). `bericht_ausfuehren`
 * und `abfrage_ausfuehren` liefern dieselbe Form — erzwungen durch das
 * gemeinsame ERGEBNIS_SCHEMA in server.ts —, brauchen aber jedes eine eigene
 * Ansichtsdatei. Die beiden sind deshalb duenne Huellen um diese Komponente.
 *
 * DIE HINWEISE STEHEN OBEN, NICHT UNTEN. Wer eine Zahl abliest und
 * weitergibt, liest die Fussnote nicht. Ein Hinweis, der erst nach fuenfzig
 * Zeilen kommt, ist keiner.
 */

export type Befund = {
  schluessel: string
  schwere: 'sperre' | 'warnung'
  hinweis: string
  berichtigung?: string | null
}

export type Datenstand = {
  umsatz_bis: string | null
  bwa_bis: string | null
  umsatz_veraltet: number
  bwa_im_rueckstand: number
} | null

export type ErgebnisDaten = {
  spalten: string[]
  zeilen: Record<string, unknown>[]
  zeilen_gesamt: number
  koernung: { sicht: string; koernung: string | null }[]
  hinweise: Befund[]
  datenstand: Datenstand
  weitere?: Record<string, unknown>[]
}

export function Ergebnistabelle({ daten }: { daten: ErgebnisDaten }) {
  const spalten = daten.spalten ?? []
  const zeilen = [...(daten.zeilen ?? []), ...(daten.weitere ?? [])]
  const hinweise = daten.hinweise ?? []
  const datenstand = daten.datenstand

  return (
    <div style={S.rahmen}>
      {hinweise.map(h => (
        <div key={h.schluessel} style={{ ...S.hinweis, ...(h.schwere === 'sperre' ? S.sperre : S.warnung) }}>
          <strong>{h.schwere === 'sperre' ? 'Gesperrt' : 'Achtung'}:</strong> {h.hinweis}
          {h.berichtigung && <div style={S.berichtigung}>→ {h.berichtigung}</div>}
        </div>
      ))}

      {(daten.koernung ?? []).map(k => k.koernung && (
        <div key={k.sicht} style={S.koernung}>
          <code>{k.sicht}</code> — eine Zeile je {k.koernung}
        </div>
      ))}

      {datenstand && (
        <div style={S.koernung}>
          Datenstand: Umsatz bis {datenstand.umsatz_bis ?? '—'}, BWA bis {datenstand.bwa_bis ?? '—'}
          {datenstand.umsatz_veraltet > 0 && ` · ${datenstand.umsatz_veraltet} Betrieb(e) mit veraltetem Umsatz`}
          {datenstand.bwa_im_rueckstand > 0 && ` · ${datenstand.bwa_im_rueckstand} mit BWA-Rückstand`}
        </div>
      )}

      <div style={S.scroll}>
        <table style={S.tabelle}>
          <thead>
            <tr>{spalten.map(s => <th key={s} style={S.kopf}>{s}</th>)}</tr>
          </thead>
          <tbody>
            {zeilen.map((z, i) => (
              <tr key={i} style={i % 2 ? S.zeileGerade : undefined}>
                {spalten.map(s => <td key={s} style={istZahl(z[s]) ? S.zahl : S.zelle}>{anzeigen(z[s])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={S.fuss}>
        {daten.zeilen_gesamt} Zeile(n)
        {daten.zeilen_gesamt > zeilen.length && ` · ${zeilen.length} gezeigt`}
      </p>
    </div>
  )
}

const istZahl = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^-?[\d.,]+$/.test(v))
const anzeigen = (v: unknown) =>
  v === null || v === undefined ? '—'
  : typeof v === 'number' ? v.toLocaleString('de-DE')
  : String(v)

const S: Record<string, React.CSSProperties> = {
  rahmen: { font: '13px/1.5 system-ui, sans-serif', color: 'var(--text, #1a1a1a)' },
  hinweis: { padding: '8px 10px', borderRadius: 6, marginBottom: 8, borderLeft: '3px solid' },
  sperre: { background: 'rgba(200,40,40,.08)', borderColor: '#c82828' },
  warnung: { background: 'rgba(210,140,0,.10)', borderColor: '#d28c00' },
  berichtigung: { marginTop: 4, opacity: .85 },
  koernung: { fontSize: 12, opacity: .7, marginBottom: 6 },
  scroll: { overflowX: 'auto', border: '1px solid rgba(128,128,128,.25)', borderRadius: 6 },
  tabelle: { borderCollapse: 'collapse', width: '100%', fontSize: 12.5 },
  kopf: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid rgba(128,128,128,.3)',
          position: 'sticky', top: 0, background: 'var(--kopf, rgba(128,128,128,.08))', whiteSpace: 'nowrap' },
  zelle: { padding: '5px 10px', whiteSpace: 'nowrap' },
  zahl: { padding: '5px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  zeileGerade: { background: 'rgba(128,128,128,.05)' },
  fuss: { fontSize: 12, opacity: .7, marginTop: 6 },
}
