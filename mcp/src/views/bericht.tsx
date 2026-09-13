/**
 * Das Ergebnis eines fertigen BERICHTS.
 *
 * Eine duenne Huelle um Ergebnistabelle — Skybridge laesst jede Ansicht
 * genau ein Werkzeug bedienen, und `abfrage_ausfuehren` hat deshalb eine
 * eigene (views/ergebnis.tsx). Dass beide dasselbe zeigen duerfen, garantiert
 * das gemeinsame ERGEBNIS_SCHEMA in server.ts.
 */
import { Ergebnistabelle, type ErgebnisDaten } from '../ergebnistabelle'
import { useToolInfo } from '../helpers'

export default function Bericht() {
  const zustand = useToolInfo<'bericht_ausfuehren'>()
  if (zustand.isPending) return <p style={{ padding: 12, font: '13px system-ui' }}>Wird geholt …</p>
  return (
    <Ergebnistabelle daten={{
      ...(zustand.output as unknown as ErgebnisDaten),
      weitere: (zustand.responseMetadata?.weitere ?? []) as Record<string, unknown>[],
    }} />
  )
}
