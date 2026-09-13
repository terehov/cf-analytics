/**
 * Wer darf was.
 *
 * DER SERVER HAT EIGENE NUTZER, sonst waere er keine Alternative zu
 * Metabase (docs/plan-skybridge.md). Die Identitaet kommt vom
 * Identitaetsanbieter als OAuth-Subject; die Stufe steht in
 * `mcp.nutzer_stufe`.
 *
 * WER DORT NICHT STEHT, BEKOMMT NICHTS. Kein stillschweigendes "lesen" fuer
 * jeden, der sich anmelden kann: der Anbieter sagt, WER jemand ist, nicht,
 * dass er die Zahlen dieses Unternehmens sehen darf. Die zweite Frage
 * beantwortet diese Tabelle, und ihre Antwort ist eine Zeile, die jemand
 * bewusst angelegt hat.
 */
import { abfragen } from './db'

export type Stufe = 'lesen' | 'fragen' | 'gesperrt'

export type Angemeldet = {
  subject: string
  anzeige: string | null
  stufe: Stufe
  client: string | null
}

export class NichtErlaubt extends Error {}

/** Aus dem geprueften Token die Kennung ziehen. */
export function subjektAus(extra: any): string | null {
  const a = extra?.http?.authInfo
  return a?.extra?.sub ?? a?.extra?.subject ?? a?.clientId ?? null
}

export function anzeigeAus(extra: any): string | null {
  const e = extra?.http?.authInfo?.extra
  return e?.name ?? e?.email ?? e?.preferred_username ?? null
}

export async function anmelden(extra: any): Promise<Angemeldet> {
  const subject = subjektAus(extra)
  if (!subject) {
    throw new NichtErlaubt(
      'Keine Anmeldung erkannt. Dieser Zugang ist nicht oeffentlich — der Connector muss mit ' +
      'dem Unternehmenskonto verbunden sein.')
  }
  const [zeile] = await abfragen<{ stufe: Stufe; anzeige: string | null }>(
    `SELECT stufe, anzeige FROM mcp.nutzer_stufe WHERE subject = $1`, [subject])

  if (!zeile || zeile.stufe === 'gesperrt') {
    throw new NichtErlaubt(
      `Fuer diese Anmeldung ist kein Zugang hinterlegt. Freischalten heisst: eine Zeile in ` +
      `mcp.nutzer_stufe mit subject = '${subject}'. Das ist Absicht — dass jemand sich anmelden ` +
      `kann, heisst nicht, dass er die Zahlen sehen darf.`)
  }
  return {
    subject,
    anzeige: zeile.anzeige ?? anzeigeAus(extra),
    stufe: zeile.stufe,
    client: extra?.http?.authInfo?.clientId ?? null,
  }
}

/** Freies SQL braucht die Stufe `fragen`. */
export function fragenDuerfen(n: Angemeldet): void {
  if (n.stufe !== 'fragen') {
    throw new NichtErlaubt(
      'Freies SQL ist fuer diese Anmeldung nicht freigegeben (Stufe "lesen"). Die fertigen ' +
      'Berichte stehen zur Verfuegung — berichte_suchen findet sie. Wer freies SQL braucht, ' +
      'bekommt in mcp.nutzer_stufe die Stufe "fragen".')
  }
}
