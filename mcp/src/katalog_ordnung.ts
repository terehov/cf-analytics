/**
 * Die Reihenfolge des Katalogabzugs — und warum sie nicht aus der Datenbank
 * kommen darf.
 *
 * BEFUND VOM 20.09.2026. `test/katalog.json` war in der Reihenfolge einer
 * macOS-Datenbank geschrieben, Produktion sortiert anders:
 *
 *   lokal (Postgres.app, en_US.UTF-8)   kalender_fehlend, kalendereffekt
 *   Produktion (Linux, glibc)           kalendereffekt, kalender_fehlend
 *
 * Beide heissen `en_US.UTF-8` und meinen Verschiedenes: glibc uebergeht den
 * Unterstrich auf der ersten Vergleichsstufe, macOS nicht. `katalog_abzug.test.ts`
 * vergleicht geordnete Arrays mit toEqual — der Test haette also gegen
 * Produktion NIE bestehen koennen, auch bei vollkommen gleichem Inhalt. Und
 * weil er nur mit gesetztem MCP_DATABASE_URL laeuft, hat das nie jemand
 * gesehen: die Abzugsdatei driftete 37 Sichten weit, ohne dass etwas meldete.
 *
 * Deshalb sortiert der Abzug in JavaScript, nach Code-Einheiten. Das ist
 * ueberall dieselbe Reihenfolge — auf jedem Rechner, in jedem Container, in
 * jeder Datenbank. Ein `ORDER BY` in SQL ist dafuer untauglich, solange die
 * Kollation der Datenbank mitspricht.
 */

/** Stabil und kollationsunabhaengig: Vergleich ueber UTF-16-Code-Einheiten. */
export function nachSchluessel<T>(zeilen: readonly T[], schluessel: (z: T) => string): T[] {
  return [...zeilen].sort((a, b) => {
    const x = schluessel(a)
    const y = schluessel(b)
    return x < y ? -1 : x > y ? 1 : 0
  })
}

/** Dieselbe Ordnung fuer eine reine Zeichenkettenliste. */
export function sortiert(werte: readonly string[]): string[] {
  return nachSchluessel(werte, w => w)
}
