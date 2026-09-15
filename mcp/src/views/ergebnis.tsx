/**
 * Das Ergebnis einer FREIEN Abfrage.
 *
 * Eine duenne Huelle um Ergebnistabelle — Skybridge laesst jede Ansicht
 * genau ein Werkzeug bedienen, und `bericht_ausfuehren` braucht deshalb eine
 * eigene (views/bericht.tsx). Dass beide dasselbe zeigen duerfen, garantiert
 * das gemeinsame ERGEBNIS_SCHEMA in server.ts.
 */
import { Ergebnistabelle, type ErgebnisDaten } from '../ergebnistabelle'
import { useToolInfo } from '../helpers'

export default function Ergebnis() {
  const zustand = useToolInfo<'abfrage_ausfuehren'>()
  if (zustand.isPending) return <p style={{ padding: 12, font: '13px system-ui' }}>Wird geholt …</p>
  return (
    <Ergebnistabelle daten={{
      ...(zustand.output as unknown as ErgebnisDaten),
      weitere: (zustand.responseMetadata?.weitere ?? []) as Record<string, unknown>[],
    }} />
  )
}
