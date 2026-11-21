/**
 * Spalten, die LINA umbenannt hat — je aktueller Name die früheren.
 *
 * Ein Bericht trägt in `felder` (src/lina/betriebsberichte.ts) und im
 * Spaltenplan den AKTUELLEN Namen. Die Schemaprüfung (`betriebsberichtSchema`)
 * nimmt eine Antwort mit einem früheren Namen als vollständig an, und der
 * Lader (`feld()` in src/transform/betriebsbericht.ts) liest dann dort. So
 * lassen sich alte Rohantworten weiter laden (harte Regel 4: core aus raw
 * neu aufbaubar) und neue gleich.
 *
 * WARUM ES DAS GIBT (21.11.2026). LINA hat in den Berichten 96 und 113 den
 * Tippfehler „Rechnung/Butschrift" berichtigt. Ab dem Geschäftstag 18.10.2026
 * (abgerufen seit 09.11.) hieß die Spalte „Rechnung/Gutschrift", unser Lader
 * las weiter den alten Namen und schrieb `art = NULL` — 223.097 Bons in
 * core.bon und ebenso viele in core.tischtransfer_bon. Die Bon-Auswertungen
 * zählen nur `art = 'Rechnung'` und standen für diese Wochen auf null.
 * Gemeldet hat es sync.schema_abweichung (438 Zeilen), gelesen hat es erst
 * die Statusmeldung vom 21.11. (`docs/fehlerkatalog.md`, 21.11.2026).
 *
 * Ein Eintrag hier ist eine Aussage über LINA, keine Bequemlichkeit: nur
 * Umbenennungen, die an echten Antworten gesehen wurden.
 */
export const FELD_ALIAS: Readonly<Record<string, readonly string[]>> = {
  'Rechnung/Gutschrift': ['Rechnung/Butschrift'],
}

/** Der Name und alle früheren — in dieser Reihenfolge gelesen. */
export function feldNamen(f: string): readonly string[] {
  return [f, ...(FELD_ALIAS[f] ?? [])]
}

/** Ist `f` ein früherer Name von `aktuell`? */
export function istFrueherName(f: string, aktuell: string): boolean {
  return (FELD_ALIAS[aktuell] ?? []).includes(f)
}
