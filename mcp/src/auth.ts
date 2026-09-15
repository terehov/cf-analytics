/**
 * Wer darf was.
 *
 * DER SERVER HAT EIGENE NUTZER — seit dem 13.09.2026 mit eigener Anmeldung
 * statt eines fremden Identitaetsanbieters (Migration 0104,
 * src/anmeldung/). Die Identitaet steht im Zugangstoken, die Stufe wird
 * trotzdem BEI JEDEM AUFRUF frisch gelesen.
 *
 * WARUM NICHT EINFACH DIE STUFE AUS DEM TOKEN. Sie steht dort auch, und sie
 * waere schneller. Aber ein Token lebt eine Stunde: wer jemandem den Zugang
 * entzieht, will nicht bis zu sechzig Minuten warten, bis das wirkt. Bei
 * drei Nutzern kostet die Abfrage nichts, und sie macht `aktiv = false` zu
 * dem, wonach es aussieht — sofort.
 *
 * WER NICHT IN `mcp.nutzer` STEHT, BEKOMMT NICHTS. Ein gueltiges Token
 * allein genuegt nicht; das Konto muss es noch geben und aktiv sein.
 */
import { nutzerNachSubject } from './anmeldung/speicher'

export type Stufe = 'lesen' | 'fragen' | 'gesperrt'

export type Angemeldet = {
  subject: string
  anzeige: string | null
  stufe: Stufe
  client: string | null
}

/** Mit Namen, damit der Eintrag in mcp.zugriff "NichtErlaubt: …" heisst und nicht "Error: …". */
export class NichtErlaubt extends Error {
  constructor(meldung: string) { super(meldung); this.name = 'NichtErlaubt' }
}

/** Aus dem geprueften Token die Kennung ziehen. */
export function subjektAus(extra: any): string | null {
  const a = extra?.http?.authInfo
  return a?.extra?.sub ?? a?.extra?.subject ?? null
}

export function anzeigeAus(extra: any): string | null {
  const e = extra?.http?.authInfo?.extra
  return e?.name ?? e?.email ?? null
}

export async function anmelden(extra: any): Promise<Angemeldet> {
  const subject = subjektAus(extra)
  if (!subject) {
    throw new NichtErlaubt(
      'Keine Anmeldung erkannt. Dieser Zugang ist nicht oeffentlich — der Connector muss mit ' +
      'einem freigeschalteten Konto verbunden sein.')
  }

  const nutzer = await nutzerNachSubject(subject)
  if (!nutzer || !nutzer.aktiv || nutzer.stufe === 'gesperrt') {
    throw new NichtErlaubt(
      'Dieses Konto ist nicht (mehr) freigeschaltet. Ein gueltiges Token allein genuegt nicht — ' +
      'das Konto muss in mcp.nutzer aktiv sein.')
  }

  return {
    subject,
    anzeige: nutzer.anzeige ?? anzeigeAus(extra),
    stufe: nutzer.stufe,
    client: extra?.http?.authInfo?.clientId ?? null,
  }
}

/** Freies SQL braucht die Stufe `fragen`. */
export function fragenDuerfen(n: Angemeldet): void {
  if (n.stufe !== 'fragen') {
    throw new NichtErlaubt(
      'Freies SQL ist fuer dieses Konto nicht freigegeben (Stufe "lesen"). Die fertigen ' +
      'Berichte stehen zur Verfuegung — berichte_suchen findet sie. Wer freies SQL braucht, ' +
      'bekommt in mcp.nutzer die Stufe "fragen".')
  }
}
