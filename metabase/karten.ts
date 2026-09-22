// =====================================================================
// Alle Karten an einer Stelle.
//
// WARUM DIESE DATEI SEIT DEM 13.09.2026 EXISTIERT. Die Karten hatten bis
// dahin genau einen Abnehmer — uebernehmen.ts, das damit das BI-Tool
// provisioniert — und die Liste stand dort mitten im Skript. Seit der
// MCP-Server dieselben Karten als Berichte ausfuehrt (docs/plan-skybridge.md),
// gibt es zwei Abnehmer, und eine zweite Liste waere eine zweite Wahrheit:
// eine Karte, die im BI-Tool steht und im Chat fehlt, faellt niemandem auf,
// bis jemand nach ihr sucht.
//
// Wer eine Kartendatei ergaenzt, ergaenzt sie HIER — danach ist sie an
// beiden Orten.
//
// Diese Datei haelt sich bewusst frei von Nebenwirkungen: kein Zugriff auf
// src/config, keine Umgebungsvariablen. Der MCP-Server laeuft mit einer
// anderen Konfiguration als der Importer und soll sie nicht mitladen
// muessen, nur um an die Kartenliste zu kommen.
// =====================================================================

import type { Karte } from './typen'
import { karten as kartenRoundTable } from './karten-round-table'
import { karten as kartenFach } from './karten-fach'
import { karten as kartenDrilldown } from './karten-drilldown'
import { karten as kartenPortfolio } from './karten-portfolio'
import { karten as kartenImport } from './karten-import'
import { karten as kartenStandort } from './karten-standort'
import { karten as kartenBewertung } from './karten-bewertung'
import { karten as kartenYext } from './karten-yext'
import { karten as kartenAktionen } from './karten-aktionen'
import { karten as kartenVergleich } from './karten-vergleich'
import { karten as kartenKalender } from './karten-kalender'
import { karten as kartenFremdeinkauf } from './karten-fremdeinkauf'
import { karten as kartenPflichtartikel } from './karten-pflichtartikel'
import { karten as kartenBounti } from './karten-bounti'
import { karten as kartenArtikelaktion } from './karten-artikelaktion'
import { karten as kartenKasse } from './karten-kasse'

export const alleKarten: Karte[] = [
  ...kartenDrilldown, ...kartenPortfolio, ...kartenRoundTable, ...kartenFach, ...kartenImport,
  ...kartenStandort, ...kartenBewertung, ...kartenAktionen, ...kartenYext, ...kartenVergleich,
  ...kartenFremdeinkauf, ...kartenPflichtartikel, ...kartenKalender, ...kartenBounti,
  ...kartenArtikelaktion, ...kartenKasse,
]

/** Eine Karte an ihrem Schluessel. */
export const karteFinden = (schluessel: string): Karte | undefined =>
  alleKarten.find(k => k.schluessel === schluessel)
