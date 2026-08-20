// =====================================================================
// Traegt die Definitionen in Metabase ein.
//
// Der Umweg ueber einen Proxy hat einen Grund. Metabase schickt
//   Content-Security-Policy: ... connect-src 'self' ...
// mit, seine eigene Seite darf also keine Anfragen nach aussen stellen.
// Ein Skript, das im Metabase-Tab laeuft, kann die Definitionen nicht
// abholen.
//
// Umgekehrt geht es: dieser Server liefert unter / eine Seite aus, die
// alles erledigt, und reicht /api/* an Metabase weiter. Fuer die Seite ist
// das gleichursprünglich, also weder CSP noch CORS im Weg. Die Anmeldung
// kommt vom Browser selbst — Cookies gelten je Host und ignorieren den
// Port, das Sitzungs-Cookie fuer localhost geht deshalb auch an :8899 und
// wird von hier unveraendert weitergereicht. Es wird nirgends gespeichert.
//
//   bun run metabase/uebernehmen.ts
//   danach im Browser http://localhost:8899/ oeffnen
//
// Ein zweiter Lauf legt nichts doppelt an: jede Karte und jedes Dashboard
// traegt seinen Schluessel als [key:...] in der Beschreibung, und danach
// wird zuerst gesucht.
// =====================================================================

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
import { dashboards } from './dashboards'
import { auslegen, MINDESTHOEHE } from './layout'
import type { Karte, Kachel, Dashboard, Reihe } from './typen'
import { config } from '../src/config'

const DB_ID = 2
const PORT = 8899
// Aus der Konfiguration, damit derselbe Befehl auch gegen eine andere
// Metabase-Instanz laeuft (Server, Testumgebung).
const METABASE = config.METABASE_URL

const alleKarten: Karte[] = [
  ...kartenDrilldown, ...kartenPortfolio, ...kartenRoundTable, ...kartenFach, ...kartenImport, ...kartenStandort,
  ...kartenBewertung, ...kartenAktionen, ...kartenYext, ...kartenVergleich, ...kartenFremdeinkauf,
  ...kartenKalender,
]

// Reihen in Kacheln umrechnen — EINMAL, damit Pruefung und Ausgabe
// dieselben Zahlen sehen.
const typVon = (s: string) => alleKarten.find(k => k.schluessel === s)?.anzeige

/** Alle Reihen eines Dashboards, ueber die Reiter hinweg. Fuer jede
 *  Pruefung, der egal ist, WO eine Karte liegt — Filter, Klicks, Schluessel. */
function reihenVon(d: Dashboard): Reihe[] {
  return d.tabs ? d.tabs.flatMap(t => t.reihen) : (d.reihen ?? [])
}

/** Kacheln eines Dashboards. Bei Reitern wird jeder Reiter fuer sich
 *  ausgelegt (y beginnt je Reiter bei 0) und traegt seinen Index. */
function kachelnVon(d: Dashboard): Kachel[] {
  if (d.tabs) {
    if (d.reihen) {
      throw new Error(`Dashboard ${d.schluessel} hat reihen UND tabs — eines von beiden.`)
    }
    if (d.tabs.length < 2) {
      throw new Error(`Dashboard ${d.schluessel}: ein einzelner Reiter ist keiner — reihen verwenden.`)
    }
    return d.tabs.flatMap((t, i) => auslegen(t.reihen, typVon).map(k => ({ ...k, tab: i })))
  }
  return auslegen(d.reihen ?? [], typVon)
}

const layoutVon = new Map<string, Kachel[]>(
  dashboards.map(d => [d.schluessel, kachelnVon(d)]))

// --- Plausibilitaet, bevor irgendetwas angelegt wird -------------------
const gesehen = new Set<string>()
for (const k of alleKarten) {
  if (gesehen.has(k.schluessel)) throw new Error(`Doppelter Kartenschluessel: ${k.schluessel}`)
  gesehen.add(k.schluessel)
}
for (const d of dashboards) {
  for (const r of reihenVon(d)) {
    for (const teil of r.teile) {
      if (teil.text === undefined && !gesehen.has(teil.karte!)) {
        throw new Error(`Dashboard ${d.schluessel} verweist auf unbekannte Karte: ${teil.karte}`)
      }
    }
  }
}

// ---------------------------------------------------------------------
// Filterpruefung.
//
// Am 27.07.2026 gemeldet: "Der Markenfilter im Round Table tut nichts."
// Nachgemessen: 10 von 11 Karten dieser Seite lasen ihn nicht. Der Filter
// stand oben, liess sich bedienen, und zehn Kacheln blieben stehen.
//
// Das ist die gefaehrlichste Sorte Fehler, die dieses System kennt --
// gefaehrlicher als eine Fehlermeldung: Wer "Enchilada" waehlt und eine
// Zahl abliest, haelt sie fuer die Zahl dieser Marke. Sie ist die Zahl
// aller Betriebe. Nichts daran sieht falsch aus.
//
// Zwei Richtungen, beide sind Fehler:
//   TOT   Kein einziges Kartenfeld liest den Filter -> er tut gar nichts.
//   TAUB  Nur ein Teil der Karten liest ihn -> die Seite antwortet
//         halb. Das ist schlimmer als tot, weil es funktioniert aussieht.
//
// Ausnahmen gehoeren dokumentiert, nicht stillschweigend geduldet:
// FILTER_AUSNAHME nennt Karte und Grund.
// ---------------------------------------------------------------------

/**
 * Karten, die einen Filter ihres Dashboards bewusst NICHT lesen.
 * Jeder Eintrag braucht einen fachlichen Grund.
 */
const FILTER_AUSNAHME: Record<string, Record<string, string>> = {
  // --- ⑫ Feiertage, Ferien, Wetter -----------------------------------
  // Die Spannweite zwischen bestem und schwaechstem Feiertag ist eine
  // LANGFRISTZAHL: sie braucht viele Termine je Feiertag, sonst gewinnt ein
  // Ausreisser. Ein Monat liesse von 190 Christi-Himmelfahrt-Tagen einen
  // uebrig, ein Quartal nicht viel mehr. Der Klick fuehrt auf ⑫, wo der
  // Zeitraum dann wirkt.
  kw_kachel_feiertagseffekt: {
    monat:    'Langfristzahl ueber alle Termine; ein Stichmonat liesse einen Termin uebrig.',
    zeitraum: 'Langfristzahl ueber alle Termine; der Zeitraum wirkt auf ⑫ nach dem Klick.',
  },
  // Die einzige Karte des Dashboards, die NACH VORN schaut: die naechsten
  // 90 Tage. Ein Zeitraumfilter auf die Vergangenheit wuerde sie leeren --
  // und zwar genau dann, wenn jemand oben einen Zeitraum einstellt, um die
  // Kacheln darueber zu schaerfen.
  kw_naechste_feiertage: {
    zeitraum: 'Schaut 90 Tage nach VORN; ein Zeitraum in der Vergangenheit leerte sie.',
  },
  // --- Zeitreihen: der Monatsfilter waehlt einen Stichmonat, und genau den
  // --- darf eine Verlaufskurve nicht haben. Sonst bleibt ein Punkt uebrig.
  // dd_marken_verlauf steht weiter unten bei den Markenkarten -- ein
  // zweiter Eintrag hier wuerde ihn ueberschreiben, nicht ergaenzen.
  pf_marken_umsatzanteil: { monat: 'Verlauf ueber alle Monate.' },
  dd_betrieb_verlauf:     { monat: 'Verlauf ueber alle Monate.' },
  dd_betrieb_tagesart:    { monat: 'Tagesverlauf; eingegrenzt wird ueber den Zeitraumfilter.' },
  dd_betrieb_effektivitaet: { monat: 'Tagesverlauf; eingegrenzt wird ueber den Zeitraumfilter.' },
  dd_betrieb_ampelverlauf:{ monat: 'Verlauf ueber alle Monate.' },
  dd_betrieb_sparte:      { monat: 'Verlauf ueber alle Monate.' },
  vg_ort_umsatz:          { monat: 'Verlauf ueber alle Monate.' },
  rt_historie:            { monat: 'Die Ampelhistorie IST der Verlauf ueber alle Monate.' },
  rt_historie_bereich:    { monat: 'Historie je Bereich ueber alle Monate.' },
  rt_ursachen_verlauf:    { monat: 'Ursachen im Zeitverlauf — ueber alle Monate.',
                            marke: 'mart.ursachen_analyse ist ueber alle Betriebe verdichtet '
                                 + 'und fuehrt keine Marke.' },
  rt_ursachen:            { marke: 'Dieselbe Verdichtung wie der Verlauf darunter — '
                                 + 'mart.ursachen_analyse fuehrt keine Marke.' },
  um_verlauf_tag:         { monat: 'Tagesverlauf; eingegrenzt wird ueber den Zeitraumfilter.' },
  um_verlauf_monat:       { monat: 'Monatsverlauf mit Vorjahr — den Zeitraum liest er als Feldfilter.' },
  um_verlauf_delta:       { monat: 'Monatsverlauf — den Zeitraum liest er als Feldfilter.' },
  pe_verlauf:             { monat: 'Quotenverlauf ueber alle Monate.' },
  bwa_kennzahlen:         { monat: 'BWA-Verlauf ueber alle gebuchten Monate.' },
  bwa_wasserfall:         { zeitraum: 'EIN Monat, EIN Wasserfall — dafuer ist der Monatsfilter da. '
                                    + 'Ueber einen Zeitraum waeren die Bloecke Summen ohne Aussage.' },

  // --- Aktionen: feste Fenster statt Stichmonat -----------------------------
  ak_uebersicht:          { monat: 'Festes 12-Monats-Fenster einschliesslich des laufenden Monats — '
                                 + 'die Frage ist "welche Aktionen laufen", nicht "welche liefen im Juni".',
                            zeitraum: 'ebenso — die Sicht aggregiert je Monat.' },
  ak_verlauf:             { monat: 'Verlauf ueber 24 Monate, damit die Jahresaktionen ganz im Bild sind.',
                            zeitraum: 'ebenso.' },
  ak_betrieb:             { zeitraum: 'Stichmonat je Betrieb — dafuer ist der Monatsfilter da.' },
  ak_steckbrief:          { monat: 'Stammdaten je Aktion ueber die gesamte Historie — "nie Umsatz gesehen" '
                                 + 'verschwaende unter jedem Zeitfilter.',
                            zeitraum: 'ebenso.',
                            betrieb: 'Der Steckbrief beschreibt die AKTION, nicht einen Betrieb.' },
  akd_steckbrief:         { marke: 'Der Steckbrief beschreibt die AKTION — mart.aktion kennt '
                                 + 'weder Marke noch Betrieb.',
                            betrieb: 'ebenso.' },

  // --- Kacheln des laufenden Monats: bewusst "jetzt", nicht "gewaehlter Monat".
  um_kachel_monat:  { monat: 'Kachel zeigt ausdruecklich den LAUFENDEN Monat.',
                      zeitraum: 'ebenso.' },
  um_kachel_gaeste: { monat: 'Kachel zeigt ausdruecklich den LAUFENDEN Monat.',
                      zeitraum: 'ebenso.' },
  um_kachel_bon:    { monat: 'Kachel zeigt ausdruecklich den LAUFENDEN Monat.',
                      zeitraum: 'ebenso.' },
  pf_kachel_aktiv:  { monat: 'Zaehlt Betriebe mit Umsatz ueber die GESAMTE Historie — '
                           + 'ein Monatsfilter wuerde die Aussage veraendern.' },

  // --- Bestandsaufnahmen ueber die ganze Historie ---------------------------
  pf_konzentration:       { monat: 'Umsatzkonzentration ueber die gesamte Historie.' },
  pf_konzentration_kurve: { monat: 'ebenso.' },
  pf_karteileichen:       { monat: 'Betriebe OHNE jeden Umsatz — ueber die gesamte Historie, '
                                 + 'sonst zaehlte ein einzelner leerer Monat mit.' },
  pf_stillgelegt:         { monat: 'Der letzte Umsatztag ist ein ZUSTAND, kein Monatswert — '
                                 + 'still ist still, egal welchen Monat man betrachtet.' },
  pf_wochentag_marke:     { betrieb: 'Vergleicht MARKEN, nicht Betriebe.' },
  // pf_gaeste_bon stand hier mit der Begruendung "liesse genau einen
  // Punkt uebrig" — die Karte ist aber eine Tabelle Betrieb x Monat, und
  // mit Betriebsfilter bleibt die Monatsreihe DIESES Betriebs uebrig.
  // Seit dem 12.08.2026 liest sie den Filter.
  pf_stabilitaet:         { betrieb: 'Rangliste ueber alle Betriebe.' },
  um_wochentag:           { monat: 'Wochenrhythmus ueber den ZEITRAUM, nicht einen Stichmonat — '
                                 + 'ein einzelner Monat hat je Wochentag nur vier Tage.' },
  um_bon_gast:            { monat: 'Monatsverlauf von Bon und Umsatz je Gast — den Zeitraum liest er als Feldfilter.' },
  um_rangliste:           { zeitraum: 'Rangliste zum Stichmonat, nicht zum Tageszeitraum.' },
  st_sparte:              { monat: 'Verlauf ueber alle Monate.' },
  st_wochenprofil:        { monat: 'Wochenprofil ueber den Zeitraum — ein Stichmonat hat je '
                                 + 'Wochentag nur vier Tage, das Muster braucht mehr.' },
  st_stunde:              { monat: 'Tagesprofil ueber die gesamte Historie.' },
  st_zeitzone:            { monat: 'Tagesprofil ueber die gesamte Historie.' },
  pe_bereich:             { monat: 'Alle Zeitraeume je Betrieb, absichtlich ungefiltert.' },
  pe_effektivitaet:       { monat: 'Alle Zeitraeume je Betrieb, absichtlich ungefiltert.' },
  vg_ort_profil:          { monat: 'Tagesprofil ueber die gesamte Historie.' },
  dd_betrieb_zeitzone:    { monat: 'Tagesprofil ueber die gesamte Historie.' },
  dd_betrieb_stunde:      { monat: 'Tagesprofil ueber die gesamte Historie.' },
  dd_betrieb_personal:    { monat: 'Alle Zeitraeume dieses Betriebs.' },
  dd_betrieb_bwa:         { monat: 'BWA-Verlauf ueber alle gebuchten Monate.' },
  dd_betrieb_massnahmen: {
    monat: 'Offene Massnahmen unabhaengig vom Stichmonat.',
    zeitraum: 'Offene Massnahmen sind offen, unabhaengig vom betrachteten Zeitraum. '
            + 'Eine faellige Massnahme aus dem Maerz verschwindet nicht dadurch, '
            + 'dass man auf den Juni schaut.',
  },
  dd_betrieb_datenstand: {
    monat: 'Datenstand ist der Stand JETZT, kein Monatswert.',
    zeitraum: 'Ebenso: "bis wann sind Umsaetze da" ist keine Frage an einen '
            + 'Zeitraum, sondern an die Gegenwart.',
  },
  bwa_buchungsstand: {
    monat: 'Buchungsstand ist der Stand JETZT, kein Monatswert.',
    zeitraum: 'Ebenso: bis wann der Steuerberater gebucht hat, ist eine Frage an '
            + 'die Gegenwart. Ein Zeitraum wuerde sie nicht einschraenken, sondern '
            + 'die Antwort verfaelschen.',
  },
  rt_massnahmen_offen:    { monat: 'Offene Massnahmen unabhaengig vom Stichmonat.' },
  rt_massnahmen_status:   { monat: 'Verteilung ueber alle Massnahmen.' },

  dd_filialen_metrikvergleich: {
    ampel: 'Zaehlt Ampeln JE BEREICH (Umsatz, Personal, WE Bar ...). Ein Filter auf '
         + 'die Gesamtampel waere zirkulaer: die Karte soll ja zeigen, woraus sich '
         + 'das Gesamturteil zusammensetzt.',
    bereich: 'Die Karte VERGLEICHT die sechs Bereiche. Ein Filter darauf liesse genau '
           + 'einen Balken uebrig -- also dasselbe Diagramm in gross, und das ist das '
           + 'Gegenteil dessen, was ein Klick darauf leisten soll.',
    intensitaet: 'Zaehlt Einzelampeln je Bereich; der Handlungsbedarf ist eine Aussage '
               + 'ueber den ganzen Betrieb und wuerde die Balken beschneiden, ohne dass '
               + 'die Achse noch dazu passt.',
  },

  // --- Die Markenkarten lesen den Markenfilter. Am 27.07.2026 standen sie
  // --- hier kurzzeitig als Ausnahme, mit der Begruendung, ein Filter liesse
  // --- "nur eine Zeile uebrig". Das war falsch herum gedacht: genau das ist
  // --- beim Filtern erwuenscht. Wer Enchilada waehlt, will Enchilada sehen.
  // --- Gemeldet am 28.07.2026, sofort zurueckgenommen.
  dd_marken_verlauf: {
    monat: 'Verlauf ueber alle Monate — ein Stichmonat ergaebe einen Punkt.',
  },

  // --- Der Bereich beschreibt eine EINZELAMPEL. Karten, die den Betrieb als
  // --- Ganzes zeigen, haben keine Bereichsspalte, an der er greifen koennte.
  dd_filialen_tabelle: {
    bereich: 'Eine Zeile je BETRIEB mit allen sechs Ampeln nebeneinander. Ein '
           + 'Bereichsfilter haette hier keine Spalte -- er wirkt auf der Liste '
           + 'darunter, die je Betrieb UND Bereich eine Zeile fuehrt.',
  },
  dd_filialen_rangliste: {
    bereich: 'Zeigt ausschliesslich die Personalkostenquote; ein Bereichsfilter waere '
           + 'entweder wirkungslos (Personal) oder wuerde die Karte leeren.',
  },
  dd_filialen_streuung: {
    bereich: 'Umsatz gegen Personalquote -- zwei fest gewaehlte Bereiche. Ein dritter '
           + 'liesse sich nicht auftragen.',
  },
  so_karte_klein: {
    bereich: 'Ein Punkt je Standort, gefaerbt nach Handlungsbedarf ueber alle Bereiche. '
           + 'Ein einzelner Bereich waere keine andere Karte, sondern eine andere Farbe -- '
           + 'und die kann Metabases Punktkarte ohnehin nicht.',
    zeitraum: 'Standorte liegen, wo sie liegen. Die Faerbung folgt dem Monatsfilter, '
            + 'die Koordinaten keinem Zeitfilter.',
  },

  // --- Stichmonat statt Zeitraum. Diese beiden Tabellen zeigen eine Zeile
  // --- JE BETRIEB fuer EINEN Monat -- das ist ihr Zweck, sie sollen
  // --- Betriebe vergleichbar machen. Ein Zeitraum daneben waere
  // --- widerspruechlich: welcher Monat stuende dann in der Zeile?
  st_sparte_anteil: {
    zeitraum: 'Eine Zeile je Betrieb fuer den Stichmonat. Der Zeitraum wirkt auf die '
            + 'Diagramme darueber, die einen Verlauf zeigen -- hier waere er die '
            + 'Frage "welcher Monat steht in der Zeile", auf die es keine Antwort gibt.',
  },
  st_zeitzone_betrieb: {
    zeitraum: 'Ebenso: Stichmonat je Betrieb, damit die Prozentwerte vergleichbar sind.',
  },

  // --- Strukturell ohne die Dimension --------------------------------------
  so_fehlend: {
    monat: 'Wer gar keine Koordinaten hat, fehlt in JEDEM Monat — die Liste ist '
         + 'zeitlos und wuerde durch einen Monatsfilter nur scheinbar kleiner.',
    marke: 'Bewusst ueber alle Marken: die Liste ist eine Arbeitsvorlage zum '
         + 'Nachtragen der Adressen, und die soll vollstaendig bleiben.',
  },
  // Die frueheren Eintraege fuer dq_backfill und im_bericht (betrieb) sind
  // gestrichen: ihre Dashboards fuehren gar keine Filter, die Ausnahmen
  // liefen ins Leere und suggerierten eine Pruefung, die nie stattfand.

  // --- Personal und BWA: Stichmonat gegen Zeitraum --------------------------
  // Beide Seiten fuehren seit dem 28.07.2026 einen Zeitraumfilter, damit
  // die Verlaeufe und Zeitraumtabellen ueberhaupt auf die Zeit hoeren --
  // vorher zeigten sie die gesamte Historie, waehrend oben ein Monat
  // eingestellt war. Die Karten hier VERGLEICHEN Betriebe fuer EINEN
  // Monat; ein Zeitraum daneben liesse offen, welcher Monat in der Zeile
  // steht.
  pe_quote_betrieb: {
    zeitraum: 'Rangliste aller Betriebe zum Stichmonat. Ueber ein Quartal waere '
            + 'unklar, welcher Monat den Rang bestimmt.',
  },
  vg_ort_metriken: {
    zeitraum: 'Vergleicht Betriebe ueber alle Kennzahlen zum Stichmonat -- die '
            + 'Ampeln gibt es je Monat einmal. Der Zeitraum wirkt auf den '
            + 'Umsatzverlauf und das Tagesprofil darunter.',
  },
  vg_ort_sparte: {
    zeitraum: 'Speisen gegen Getraenke je Betrieb fuer EINEN Monat. Ueber ein '
            + 'Quartal waeren es Summen, und die Zeile sagte nicht, aus welchem '
            + 'Monat sie stammt.',
  },
  pe_quote_tabelle: {
    zeitraum: 'Eine Zeile je Betrieb zum Stichmonat -- dafuer ist der Monatsfilter da.',
  },
  bwa_ebit: {
    zeitraum: 'EBIT je Betrieb fuer EINEN gebuchten Monat. Ueber mehrere Monate '
            + 'waere der Balken eine Summe und die Marge daneben keine Marge mehr.',
  },

  // --- ③ Betrieb: Stichmonat gegen Zeitraum ---------------------------------
  // Die Seite fuehrt seit dem 28.07.2026 BEIDE Zeitfilter. Der Monat gilt
  // den Ampeln und Kennzahlen, der Zeitraum den Verlaeufen darunter --
  // vorher hoerten die Strukturdiagramme auf gar keinen von beiden und
  // zeigten dreieinhalb Jahre, waehrend oben ein Monat eingestellt war.
  //
  // Was hier steht, sind die Karten, fuer die ein ZEITRAUM keinen Sinn
  // ergibt, weil sie einen Stichmonat zeigen. Das ist kein Versehen und
  // keine Bequemlichkeit: "Umsatz im Juni" mit einem Zeitraum von drei
  // Monaten daneben waere die Frage, welcher Monat in der Zahl steht -- und
  // darauf gibt es keine Antwort, die man ablesen koennte.
  dd_betrieb_umsatz_kachel: {
    zeitraum: 'Kennzahl EINES Monats. Ein Zeitraum daneben liesse offen, welcher '
            + 'Monat in der Zahl steht.',
  },
  dd_betrieb_ytd_kachel: {
    zeitraum: 'Aufgelaufener Wert seit Jahresbeginn -- der Anfang steht fest, '
            + 'ein Zeitraum wuerde ihn verschieben und die Zahl waere kein YTD mehr.',
  },
  dd_betrieb_gaeste_kachel: { zeitraum: 'Kennzahl EINES Monats, wie die Umsatzkachel.' },
  dd_betrieb_bon_kachel:    { zeitraum: 'Kennzahl EINES Monats, wie die Umsatzkachel.' },
  dd_betrieb_kopf: {
    zeitraum: 'Die sechs Ampeln gibt es je Monat einmal. Genau dafuer ist der '
            + 'Monatsfilter da; ein Zeitraum ergaebe sechs Zeilen je Monat '
            + 'uebereinander, ohne dass die Zeile sagt, aus welchem.',
  },
  dd_betrieb_artikel: {
    zeitraum: 'Die 30 meistverkauften Artikel EINES Monats. Ueber ein Quartal '
            + 'waere es eine andere Rangliste -- richtig, aber nicht die, die '
            + 'neben den Ampeln desselben Monats steht.',
  },

  // --- Belege und Inventuren: eigene Zeitlogik statt Stichmonat -------------
  // Eine Belegliste ist kein Monatswert wie die sechs Ampeln -- sie liest
  // bereits den Zeitraumfilter ueber einen Feldfilter auf bestelldatum. Ein
  // zusaetzlicher Stichmonat waere ein zweiter, widersprechender Zeitfilter
  // auf derselben Liste.
  dd_betrieb_bestellungen: {
    monat: 'Belegliste mit eigenem Zeitraumfilter (Feldfilter auf bestelldatum). '
         + 'Ein zusaetzlicher Stichmonat waere ein zweiter, widersprechender '
         + 'Zeitfilter auf derselben Liste.',
  },
  // Inventuren sind seltene Ereignisse -- bei Wilma Wunder rund 275 ueber
  // mehrere Jahre, bei den anderen drei Marken einstellig (core.inventur,
  // Migration 0044). Ein Drei-Monats-Fenster liesse die Liste fast immer
  // leer erscheinen und saehe aus wie "keine Inventuren", wo in Wahrheit nur
  // keine im Fenster liegen. Die Karte zeigt deshalb bewusst ALLE Inventuren
  // des Betriebs, neueste zuerst -- wie dd_betrieb_massnahmen es fuer offene
  // Massnahmen schon tut.
  dd_betrieb_inventur: {
    monat: 'Zeigt alle Inventuren des Betriebs, nicht die eines Stichmonats -- '
         + 'bei seltenen Zaehlungen liesse ein Monat die Liste fast immer leer '
         + 'erscheinen.',
    zeitraum: 'ebenso -- ein Drei-Monats-Fenster traefe die meisten Inventuren '
             + 'gar nicht.',
  },

  // --- Die einzelne Zaehlung: gefiltert wird ueber DIE INVENTUR -------------
  // Beide Karten haengen an einem Inventurschluessel, der den Betrieb, den
  // Monat und den Zeitraum bereits mitbringt -- eine Zaehlung gehoert zu genau
  // einem Betrieb und genau einem Tag. Ein zusaetzlicher Betriebsfilter koennte
  // die gewaehlte Zaehlung nur noch wegfiltern.
  dd_inventur_kopf: {
    betrieb: 'Die Zaehlung bringt ihren Betrieb mit -- ausgewaehlt wird ueber sie.',
    monat: 'ebenso: eine Zaehlung hat genau ein Datum.',
    zeitraum: 'ebenso.',
  },
  dd_inventur_positionen: {
    betrieb: 'Die Zaehlung bringt ihren Betrieb mit -- ausgewaehlt wird ueber sie.',
    monat: 'ebenso: eine Zaehlung hat genau ein Datum.',
    zeitraum: 'ebenso.',
  },

  // --- Der einzelne Beleg: gefiltert wird ueber DIE BESTELLUNG --------------
  // Dieselbe Begruendung wie bei der Zaehlung: ein Beleg gehoert zu genau
  // einem Betrieb und genau einem Tag, beides bringt der Schluessel mit.
  dd_beleg_kopf: {
    betrieb: 'Der Beleg bringt seinen Betrieb mit -- ausgewaehlt wird ueber ihn.',
    monat: 'ebenso: ein Beleg hat genau ein Bestelldatum.',
    zeitraum: 'ebenso.',
  },
  dd_beleg_positionen: {
    betrieb: 'Der Beleg bringt seinen Betrieb mit -- ausgewaehlt wird ueber ihn.',
    monat: 'ebenso: ein Beleg hat genau ein Bestelldatum.',
    zeitraum: 'ebenso.',
  },

  // --- Einkauf: die drei Sichten kennen keinen Betrieb ----------------------
  // FoodNotify verhandelt Preise je MARKE, nicht je Betrieb. mart.einkauf_ladestand,
  // mart.einkaufspreis_monat und mart.einkaufspreis_veraenderung fuehren
  // deshalb `marke` und keine Betriebsspalte -- ein Betriebsfilter haette
  // hier nichts, worauf er zeigen koennte.
  // --- Einkauf --------------------------------------------------------------
  // Der WARE-Filter (0062) ist von Natur aus auf die beiden Preiskarten
  // beschraenkt: er waehlt EINEN Artikel, und die uebrigen Karten dieser Seite
  // verdichten ueber alle Artikel -- je Lieferant, je Betrieb, je Marke. Sie
  // koennten ihn zwar lesen, wuerden dann aber etwas anderes zeigen, als ihr
  // Titel verspricht ("Lieferanten nach Einkaufsvolumen" mit einem einzigen
  // Artikel darin ist keine Lieferantenrangliste mehr).
  wa_ladestand: {
    betrieb: 'Ladestand je Marke; die Sicht fuehrt keinen Betrieb.',
    ware: 'Zaehlt geladene BESTELLUNGEN, nicht Artikel -- eine Ware einzugrenzen '
        + 'wuerde den Ladestand kleiner aussehen lassen, als er ist.',
  },
  wa_preise:              { betrieb: 'Einkaufspreise gelten je Marke, nicht je Betrieb.' },
  wa_preis_veraenderung:  { betrieb: 'ebenso -- Preisentwicklung je Marke.',
                            ware: 'Die Karte IST die Rangliste der groessten Spruenge ueber alle '
                                + 'Artikel. Mit einer gewaehlten Ware bleibt eine Zeile uebrig, '
                                + 'und die steht daneben schon im Verlauf.' },
  wa_preis_verlauf:       { betrieb: 'Einkaufspreise gelten je Marke, nicht je Betrieb -- '
                                   + 'mart.einkaufspreis_monat fuehrt keinen Betrieb.' },
  wa_lieferant_volumen:   { ware: 'Rangliste der Lieferanten ueber ihr gesamtes Sortiment.' },
  wa_lieferant_konzentration: { ware: 'Beschaffungsrisiko je Betrieb ueber alle Artikel -- der '
                                    + 'Anteil des groessten Lieferanten an EINER Ware sagt nichts.' },
  wa_einkauf_betrieb:     { ware: 'Einkaufsvolumen je Betrieb und Monat, ueber alle Artikel.' },
  wa_einkauf_pruefung:    { ware: 'Pruefliste ueber alle auffaelligen Positionen; wer sie nach '
                                + 'einer Ware filtert, sieht nicht mehr, was sonst auffiel.' },
  wa_inventur_schwund:    { ware: 'Inventuren zaehlen Bestaende, keine Bestellartikel.' },

  // --- Fremdeinkauf (0055/0058) ---------------------------------------------
  fe_kachel_verweis: {
    monat: 'Festes 12-Monats-Fenster -- die Kachel fragt "wie viel laeuft am Konzern '
         + 'vorbei", nicht "wie viel im Juni".',
    zeitraum: 'ebenso.',
    marke: 'BEWUSST ohne Markenfilter. db_einkauf filtert nach dem FoodNotify-Mandanten, '
         + 'mart.fremdeinkauf fuehrt das Round-Table-Konzept. Beide Filter heissen marke; '
         + 'verdrahtet stuende hier dauerhaft eine leere Kachel ohne Fehlermeldung.',
    ware: 'Verweiskachel auf eine andere Seite; sie zeigt eine Summe, keinen Artikel.',
  },
  // fe_betriebe_betroffen stand hier mit "0 oder 1 -- eine Zahl, die
  // nichts sagt". Verworfen am 12.08.2026: neben drei gefilterten
  // Nachbarkacheln las sich die ungefilterte 48 als Aussage ueber den
  // gewaehlten Betrieb — 1 oder 0 sagt dagegen genau das Richtige.
  fe_freigabestand:       { betrieb: 'Die Freigabeliste gilt konzernweit; sie kennt keinen Betrieb.',
                            marke: 'ebenso -- ein Dachlieferant gehoert keiner Marke.' },
  fe_pflegestand:         { betrieb: 'Zaehlt den Stand der drei Pflegetabellen. Die gelten '
                                   + 'konzernweit -- ein Betriebsfilter machte aus "5 von 32 '
                                   + 'eingeordnet" eine Zahl ueber nichts.',
                            marke: 'ebenso.' },
  ep_nicht_vergleichbar:  { betrieb: 'Zaehlt, WARUM Waren aus dem Preisvergleich fallen. Die '
                                   + 'Sperren gelten konzernweit je Ware, nicht je Betrieb.' },

  // --- Bewertungen ---------------------------------------------------------
  bw_verlauf: {
    monat: 'Verlauf ueber alle Monate -- ein Stichmonat liesse genau einen Punkt uebrig.',
    zeitraum: 'Aggregiert je Monat, nicht je Tag.',
  },
  bw_marke: {
    marke: 'Die Karte VERGLEICHT die Marken. Ein Markenfilter liesse einen '
         + 'einzigen Balken stehen, und ein Balken ist kein Vergleich.',
  },
  bw_ladestand: {
    monat: 'Technische Karte: was der Importer zuletzt geholt hat, ueber den '
         + 'gesamten geladenen Zeitraum. Ein Monatsfilter beantwortete die '
         + 'Frage "fehlen Daten?" gerade nicht mehr.',
    marke: 'ebenso -- der Ladestand haengt am Importer, nicht an der Marke.',
  },
  bw_fehlend: {
    monat: 'Fehlende Zuordnung ist ein ZUSTAND, kein Monatswert.',
    marke: 'Bewusst ueber alle Marken: die Liste ist eine Arbeitsvorlage zum '
         + 'Nachtragen, und die soll vollstaendig bleiben — wie so_fehlend.',
  },
  bw_anteil_schlecht: {
    monat: 'Festes Fenster: 90 Tage gegen die zwoelf Monate davor. Ein '
         + 'Stichmonat zerstoerte genau den Vergleich, der die Karte ist.',
  },
  bw_portalvergleich: {
    monat: 'Festes 12-Monats-Fenster — der Portal-Bias ist strukturell, '
         + 'nicht monatlich.',
  },
  // Die Bewertungs-Rangliste auf ② Filialen liest Monat und Marke, aber
  // NICHT die drei Round-Table-Filter. Sie sortiert nach der Bewertung;
  // wer zusaetzlich auf "gesamt rot" filtert, bekaeme "die
  // bestbewerteten unter den roten Betrieben" -- eine Liste, die
  // aussieht wie eine Bestenliste und keine ist. Die Bewertungsampel
  // steht in der Zeile und ordnet an Ort und Stelle ein.
  bw_rangliste: {
    ampel:        'Rangliste nach BEWERTUNG, nicht nach der Gesamtampel.',
    bereich:      'Der Bereich ist hier fest: es geht um die Bewertung.',
    intensitaet:  'Eskalationsstufe des Round Table; sagt ueber die Bewertung nichts.',
  },

  // Die Wortlaut-Liste liest Betrieb, Marke und die Note -- aber weder
  // Stichmonat noch Zeitraum. Geschriebene Rueckmeldungen sind selten:
  // Enchilada Bremen bekam im Mai 2026 eine einzige Bewertung, und die
  // ohne Text. Ein Drei-Monats-Fenster laesst dort eine Zeile uebrig und
  // sieht aus, als fehlten die Daten. Stattdessen feste 24 Monate,
  // neueste zuerst.
  bw_einzel: {
    monat: 'Festes Fenster von 24 Monaten, neueste zuerst -- ein Stichmonat laesst '
         + 'bei kleinen Betrieben keine lesbare Zahl an Rueckmeldungen uebrig.',
    zeitraum: 'ebenso.',
  },
  // Die Verlaufskurve: der Monatsfilter waehlt einen Stichmonat, und der
  // liesse von einer Kurve genau einen Punkt uebrig.

  // --- Yext Analytics: Themen, Antworten, Sichtbarkeit ---------------------
  // Dieselbe Mechanik wie bei den Bewertungskarten darueber, ein Grund
  // kommt hinzu: die Themen gibt es erst seit April 2026. Ein Stichmonat
  // auf einer Verlaufskurve liesse dort nicht nur einen Punkt uebrig, er
  // liesse bei jedem aelteren Monat GAR NICHTS uebrig -- und eine leere
  // Karte liest sich als "keine Probleme".
  yx_themen_verlauf: {
    monat: 'Verlauf ueber alle Monate -- ein Stichmonat liesse einen Punkt uebrig.',
    note:  'Die Themennote IST die Aussage der Karte; auf eine Sternezahl gefiltert '
         + 'bliebe eine Tautologie stehen.',
  },
  yx_antwort_verlauf: {
    monat: 'Verlauf ueber alle Monate.',
  },
  yx_note_verteilung: {
    monat: 'Die Verteilung ueber die Monate IST die Karte.',
  },
  yx_sicht_trichter: {
    monat: 'Verlauf ueber alle Monate.',
  },
  yx_themen_unbekannt: {
    monat: 'Waechterkarte: ein unbekanntes Label soll auffallen, egal wann es auftauchte. '
         + 'Mit Monatsfilter waere es genau in den Monaten unsichtbar, die niemand ansieht.',
  },
  yx_themen_stand: {
    monat: 'Sagt, AB WANN es Themen gibt -- ein Monatsfilter beantwortete genau diese '
         + 'Frage nicht mehr.',
    marke: 'Der Erhebungszeitraum haengt an Yext, nicht an der Marke.',
  },
  yx_datenstand: {
    monat: 'Technische Karte: bis wann Yext welche Zahl als vollstaendig meldet. '
         + 'Ein Monatsfilter waere hier sinnlos -- wie bei bw_ladestand.',
    marke: 'Der Datenstand haengt am Importer, nicht an der Marke.',
  },
  // Auf ② Filialen liest das Themenprofil Monat und Marke, aber nicht die
  // drei Round-Table-Filter -- aus demselben Grund wie bw_rangliste: es
  // ordnet nach der Themennote, und wer zusaetzlich auf "gesamt rot"
  // filtert, bekaeme "die themenstaerksten unter den roten Betrieben".
  yx_themen_betrieb: {
    ampel:        'Profil nach THEMEN, nicht nach der Gesamtampel.',
    bereich:      'Der Bereich ist hier fest: es geht um die Bewertung.',
    intensitaet:  'Eskalationsstufe des Round Table; sagt ueber die Themen nichts.',
    note:         'Die Karte zeigt Durchschnittsnoten je Thema; ein Filter auf eine '
                + 'einzelne Sternezahl liesse leere Spalten stehen.',
    zeitraum:     'Stichmonat je Betrieb -- dafuer ist der Monatsfilter da.',
  },
  yx_themen: {
    note:     'Die Karte zeigt Durchschnittsnoten je Thema; auf eine Sternezahl '
            + 'gefiltert waere jede Note gleich der gefilterten.',
    zeitraum: 'Stichmonat -- dafuer ist der Monatsfilter da.',
  },
  yx_antwort_rangliste: {
    note:     'Antwortverhalten haengt nicht an der Sternezahl der Bewertung; die '
            + 'Spalte "Offen 1-2★" traegt den Bezug bereits in sich.',
    zeitraum: 'Stichmonat -- dafuer ist der Monatsfilter da.',
  },

  // --- Vergleichsgruppen ---------------------------------------------------
  // Eine fehlende Ortsangabe ist kein Monatswert, sondern ein Zustand der
  // Stammdaten. Mit Monatsfilter waere die Liste im Juni eine andere als
  // im Juli, obwohl sich nichts geaendert hat -- und die Frage "wer fehlt
  // im Stadtvergleich" haette je Monat eine andere Antwort.
  vs_fehlend: { monat: 'Fehlende Ortsangabe ist ein Zustand der Stammdaten, kein Monatswert.' },

  // Die beiden Vergleichskarten auf ③ Betrieb. Dort gibt es neben dem
  // Monat auch einen Zeitraumfilter -- den koennen sie nicht lesen.
  dd_betrieb_vergleich: {
    zeitraum: 'Die sechs Kennzahlen gibt es je Monat einmal, wie bei dd_betrieb_kopf '
            + 'darueber. Ein Zeitraum ergaebe sechs Zeilen je Monat uebereinander.',
  },
  dd_betrieb_vergleich_verlauf: {
    zeitraum: 'Liest DREI Tabellen (Betrieb, Marke, Stadt). Ein Feldfilter baut seine '
            + 'Klausel aus dem Tabellennamen und koennte nur einen der drei Aeste '
            + 'einschraenken -- die Linien waeren still verschieden lang. Das Fenster '
            + 'sind feste 24 Monate am Monatsfilter.',
  },
}

// Doppelte Schluessel in FILTER_AUSNAHME sind in JavaScript erlaubt: der
// spaetere gewinnt, der fruehere verschwindet lautlos. Genau das passierte
// am 27.07.2026, als dd_marken_verlauf einen zweiten Eintrag bekam -- die
// Monatsbegruendung war weg, ohne dass irgendetwas gemeldet haette.
//
// Der Quelltext ist die einzige Stelle, an der man das noch sehen kann;
// im ausgewerteten Objekt ist der Verlust bereits eingetreten.
{
  const quelle = await Bun.file(import.meta.path).text()
  const block = quelle.slice(quelle.indexOf('const FILTER_AUSNAHME'))
  const bisEnde = block.slice(0, block.indexOf('\n}\n'))
  const gesehen = new Set<string>()
  const doppelt: string[] = []
  for (const t of bisEnde.matchAll(/^  ([a-z_][a-z0-9_]*):\s*\{/gm)) {
    if (gesehen.has(t[1]!)) doppelt.push(t[1]!)
    gesehen.add(t[1]!)
  }
  if (doppelt.length > 0) {
    throw new Error(
      'FILTER_AUSNAHME hat doppelte Eintraege: ' + doppelt.join(', ') +
      '\n  Der spaetere ueberschreibt den frueheren stillschweigend. Zusammenfassen.')
  }
}

// ---------------------------------------------------------------------
// Feldfilter vertragen keinen Tabellenalias.
//
// Metabase baut die Klausel eines Feldfilters aus dem TABELLENNAMEN:
// aus {{zeitraum}} auf mart.bwa_kennzahl.monat wird
//   bwa_kennzahl.monat BETWEEN ... AND ...
// Steht die Tabelle im SQL unter einem Alias (FROM mart.bwa_kennzahl k),
// ist dieser Name an der Stelle nicht mehr gueltig, und Postgres
// antwortet mit "invalid reference to FROM-clause entry".
//
// Das faellt nicht beim Anlegen auf und nicht beim Oeffnen der Karte,
// sondern erst, wenn jemand den Filter WIRKLICH setzt -- ohne Wert faellt
// der optionale Block [[...]] weg und die Abfrage laeuft. Genau so
// passierte es am 28.07.2026 gleich viermal an einem Nachmittag.
// ---------------------------------------------------------------------
{
  const aliasFehler: string[] = []
  for (const k of alleKarten) {
    for (const [tag, ziel] of Object.entries(k.template_tag_dimension ?? {})) {
      const [schema, tabelle] = ziel
      // Ein Wort nach dem Tabellennamen, das kein SQL-Schluesselwort ist,
      // ist ein Alias.
      const re = new RegExp(
        `(?:FROM|JOIN)\\s+${schema}\\.${tabelle}\\s+(?!ON\\b|WHERE\\b|GROUP\\b|ORDER\\b|` +
        `HAVING\\b|LIMIT\\b|CROSS\\b|LEFT\\b|RIGHT\\b|INNER\\b|FULL\\b|JOIN\\b|UNION\\b)` +
        `([a-z][a-z0-9_]*)`, 'i')
      const treffer = k.sql.match(re)
      if (treffer) {
        aliasFehler.push(
          `${k.schluessel}: Feldfilter {{${tag}}} zeigt auf ${schema}.${tabelle}, ` +
          `aber die Tabelle steht im SQL unter dem Alias "${treffer[1]}". ` +
          `Alias entfernen — sonst scheitert die Karte, sobald der Filter gesetzt wird.`)
      }
    }
  }
  if (aliasFehler.length > 0) {
    throw new Error('Feldfilter auf Tabelle mit Alias:\n  ' + aliasFehler.join('\n  '))
  }
}

/** Welche Variablen eine Karte tatsaechlich liest — inklusive der aus den
 *  gemeinsamen CTE-Bausteinen geerbten. Genau die wurden bei der ersten
 *  Pruefung uebersehen, weshalb `monat` faelschlich ueberall als tot galt. */
function variablenVon(karte: Karte): Set<string> {
  const v = new Set<string>()
  for (const m of karte.sql.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) v.add(m[1]!)
  return v
}

/**
 * Filter, die auf einem Dashboard AUSDRUECKLICH nur eine Karte betreffen.
 *
 * Der Regelfall ist der andere: ein Filter im Kopf soll alles darunter
 * bewegen, und wenn er das bei der Haelfte nicht tut, ist das ein Fehler
 * — die Pruefung darunter faengt genau das.
 *
 * Es gibt aber Filter, die von vornherein nur zu EINER Karte gehoeren.
 * "Sterne" auf ③ Betrieb ist so einer: er grenzt die Rueckmeldungen auf
 * eine Note ein, und dass daraufhin der Monatsumsatz gleich bleibt, ist
 * kein Versehen, sondern selbstverstaendlich. Siebzehn Einzelausnahmen
 * dafuer einzutragen wuerde die Ausnahmeliste unlesbar machen und den
 * eigentlichen Grund verstecken.
 *
 * Der Eintrag hier ist deshalb enger als eine Ausnahme, nicht weiter: er
 * nennt die EINE Karte, die den Filter lesen MUSS. Liest sie ihn nicht,
 * schlaegt die Pruefung weiterhin zu.
 */
const FILTER_NUR_FUER: Record<string, Record<string, string>> = {
  // dashboard: { filter: karte }
  dd_betrieb: { note: 'bw_einzel' },
}

const filterFehler: string[] = []
for (const d of dashboards) {
  const karten = reihenVon(d).flatMap(r => r.teile)
    .filter(t => t.text === undefined)
    .map(t => alleKarten.find(k => k.schluessel === t.karte)!)
  if (karten.length === 0) continue

  for (const f of d.filter ?? []) {
    const slug = f.name
    const liest = karten.filter(k => variablenVon(k).has(slug))

    // Filter, die ausdruecklich zu genau einer Karte gehoeren: geprueft
    // wird dann NUR, ob diese eine Karte ihn auch wirklich liest.
    const nurFuer = FILTER_NUR_FUER[d.schluessel]?.[slug]
    if (nurFuer) {
      if (!liest.some(k => k.schluessel === nurFuer)) {
        filterFehler.push(
          `${d.schluessel}: Filter "${slug}" ist fuer Karte "${nurFuer}" erklaert, ` +
          `aber die liest ihn nicht.`)
      }
      continue
    }

    const taub = karten.filter(k => !variablenVon(k).has(slug)
                                 && !FILTER_AUSNAHME[k.schluessel]?.[slug])

    if (liest.length === 0) {
      filterFehler.push(
        `${d.schluessel}: Filter "${slug}" ist TOT — keine der ${karten.length} Karten liest ihn.`)
    } else if (taub.length > 0) {
      filterFehler.push(
        `${d.schluessel}: Filter "${slug}" wirkt nur auf ${liest.length} von ${karten.length} Karten. ` +
        `Ohne Wirkung: ${taub.map(k => k.schluessel).join(', ')}. ` +
        `Entweder Klausel ergaenzen oder in FILTER_AUSNAHME begruenden.`)
    }
  }
}
if (filterFehler.length > 0) {
  throw new Error('Filter ohne Wirkung:\n  ' + filterFehler.join('\n  '))
}

// ---------------------------------------------------------------------
// Filterdurchreichung.
//
// Wer oben "Juni 2026" und "Aposto" einstellt und dann auf eine Ampel
// klickt, erwartet die Einschraenkung im Zieldashboard wieder. Bisher
// blieb sie auf jeder Ebene zurueck: alle 43 Drill-Downs verloren den
// Monat, die Round-Table-Kacheln zusaetzlich die Marke. Man landete auf
// einer Liste, die nach der gefilterten aussah und es nicht war --
// schlimmer als ein toter Klick.
//
// Von Hand ist das nicht zu halten. Deshalb gilt hier die Regel: jeder
// Filter, den QUELLE und ZIEL unter demselben Namen kennen, wird
// mitgegeben, sofern die Kachel ihn nicht schon selbst belegt. Ein
// ausdrueckliches `uebergabe` gewinnt immer -- die Betriebstabelle gibt
// ihre Zeile weiter und nicht den Filter von oben.
//
// Ausgenommen ist nur, was fachlich nicht passt: der Bewertungsfilter
// gehoert nicht auf das Betriebsblatt (dort ist der Betrieb schon
// gewaehlt), und eine Kachel, die auf einen FESTEN Wert klickt, darf
// diesen einen Filter nicht von oben ueberschrieben bekommen.
// ---------------------------------------------------------------------
const NICHT_DURCHREICHEN: Record<string, string[]> = {
  // Ziel-Dashboard -> Filter, die dort nicht von oben kommen sollen
  dd_betrieb: ['marke', 'ampel'],  // ein Betrieb hat genau eine Marke und eine Ampel
  db_umsatz: ['marke'], db_struktur: ['marke'], db_personal: ['marke'],
  db_ware: ['marke'], db_bwa: ['marke'],
}

for (const d of dashboards) {
  const quellFilter = (d.filter ?? []).map(f => f.name)
  if (quellFilter.length === 0) continue
  for (const r of reihenVon(d)) {
    for (const teil of r.teile) {
      for (const k of teil.klick ?? []) {
        const ziel = dashboards.find(x => x.schluessel === k.ziel)
        if (!ziel) continue
        const zielFilter = new Set((ziel.filter ?? []).map(f => f.name))
        const gesperrt = new Set(NICHT_DURCHREICHEN[k.ziel] ?? [])
        for (const slug of quellFilter) {
          if (!zielFilter.has(slug)) continue        // Ziel kennt ihn nicht
          if (slug in k.uebergabe) continue          // Kachel belegt ihn selbst
          if (gesperrt.has(slug)) continue           // fachlich nicht sinnvoll
          ;(k.durchreichen ??= []).push(slug)
        }
      }
    }
  }
}

// ---------------------------------------------------------------------
// Klickpruefung: fuehrt jeder Drill-Down irgendwohin, wo der uebergebene
// Wert auch ankommt?
//
// Ein Klick, dessen Ziel den Parameter nicht kennt, oeffnet das
// Zieldashboard UNGEFILTERT. Man landet auf "③ Betrieb" und sieht
// irgendeinen Betrieb -- meist den zuletzt gewaehlten. Das ist schlimmer
// als ein toter Klick, weil man die falsche Zeile fuer die richtige haelt.
// ---------------------------------------------------------------------
const klickFehler: string[] = []
for (const d of dashboards) {
  for (const r of reihenVon(d)) {
    for (const teil of r.teile) {
      for (const k of teil.klick ?? []) {
        const ziel = dashboards.find(x => x.schluessel === k.ziel)
        if (!ziel) {
          klickFehler.push(`${d.schluessel}/${teil.karte}: Klickziel "${k.ziel}" gibt es nicht.`)
          continue
        }
        for (const slug of Object.keys(k.uebergabe)) {
          if (!(ziel.filter ?? []).some(f => f.name === slug)) {
            klickFehler.push(
              `${d.schluessel}/${teil.karte}: uebergibt "${slug}" an ${k.ziel}, ` +
              `aber dort gibt es diesen Filter nicht — der Klick landet ungefiltert.`)
          }
        }
        // Die QUELLSEITE der Uebergabe ist ein Spaltenname der Karte.
        // Metabase prueft ihn nicht: ein parameterMapping auf eine
        // Spalte, die es nicht gibt, wird gespeichert und uebergibt dann
        // schlicht NICHTS — das Ziel oeffnet mit leerem Filter. Genau so
        // verloren am 04.08.2026 alle sechs Fach-Klicks auf ③ Betrieb
        // ihren Betrieb. Wer den Dashboard-Filter meint, laesst die
        // uebergabe leer und ueberlaesst es der Durchreichung oben.
        if (!k.fest) {
          const karte = alleKarten.find(x => x.schluessel === teil.karte)
          const spalten = [
            ...Object.values(k.uebergabe).map(s => [s, 'uebergabe'] as const),
            ...(k.spalte ? [[k.spalte, 'klickbare Spalte'] as const] : []),
          ]
          for (const [spalte, rolle] of spalten) {
            const muster = new RegExp(
              `AS\\s+"${spalte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i')
            if (karte && !muster.test(karte.sql)) {
              klickFehler.push(
                `${d.schluessel}/${teil.karte}: ${rolle} liest Spalte "${spalte}", ` +
                `aber die Karte gibt sie nicht aus (kein AS "${spalte}" in der SQL) — ` +
                `der Klick uebergibt einen leeren Wert.`)
            }
          }
        }
      }
    }
  }
}
if (klickFehler.length > 0) {
  throw new Error('Drill-Down ohne Wirkung:\n  ' + klickFehler.join('\n  '))
}

// ---------------------------------------------------------------------
// Layoutpruefung.
//
// Metabase nimmt ueberlappende Kacheln klaglos entgegen und schiebt sie
// beim Rendern uebereinander — der Fehler faellt erst im Browser auf, und
// dort sieht er aus wie ein Darstellungsproblem statt wie eine falsche
// Zahl in der Definition. Deshalb hier, wo er noch billig ist.
//
// Ebenso die Mindesthoehen: eine Tabelle auf vier Rastereinheiten zeigt
// Kopfzeile und zwei Datenzeilen, den Rest schneidet sie ab.
// ---------------------------------------------------------------------
for (const d of dashboards) {
  const belegt = layoutVon.get(d.schluessel)!.map(k => ({
    name: k.text !== undefined ? 'Text' : k.karte,
    x: k.x, y: k.y, b: k.breite, h: k.hoehe, tab: k.tab,
  }))

  for (const k of belegt) {
    if (k.x + k.b > 24) {
      throw new Error(`${d.schluessel}: Kachel ${k.name} ragt aus dem Raster (x=${k.x} + breite=${k.b} > 24)`)
    }
  }

  for (let i = 0; i < belegt.length; i++) {
    for (let j = i + 1; j < belegt.length; j++) {
      const a = belegt[i]!, b = belegt[j]!
      // Jeder Reiter hat seine eigene Flaeche — y beginnt dort wieder bei 0.
      if (a.tab !== b.tab) continue
      if (a.x < b.x + b.b && b.x < a.x + a.b && a.y < b.y + b.h && b.y < a.y + a.h) {
        throw new Error(
          `${d.schluessel}: ${a.name} und ${b.name} ueberlappen sich ` +
          `(${a.x},${a.y} ${a.b}x${a.h} gegen ${b.x},${b.y} ${b.b}x${b.h})`)
      }
    }
  }

  for (const k of layoutVon.get(d.schluessel)!) {
    if (k.text !== undefined) continue
    const typ = typVon(k.karte) ?? 'bar'
    const noetig = MINDESTHOEHE[typ] ?? 8
    if (k.hoehe < noetig) {
      throw new Error(
        `${d.schluessel}: Kachel ${k.karte} ist zu niedrig (hoehe=${k.hoehe}, ` +
        `noetig fuer ${typ}: ${noetig})`)
    }
  }
}

/**
 * Welchen Typ die KARTE fuer einen Parameter melden darf.
 *
 * Metabase prueft beim Ausfuehren einer einzelnen Karte streng gegen den
 * Typ des template-tags. Eine SQL-Variable ist dort `date`, und dagegen
 * sind nur `category`, `date` und `date/single` zulaessig -- alles
 * feinere (`date/month-year`, `date/range`, `date/all-options`) laesst
 * Metabase zwar speichern, quittiert es beim Aufruf aber mit 500.
 *
 * Feldfilter (`dimension`) sind davon nicht betroffen: sie haengen an
 * einer echten Spalte, nicht an einer Variablen.
 */
function kartenParameterTyp(typ: string): string {
  if (!typ.startsWith('date')) return typ
  return typ === 'date' || typ === 'date/single' ? typ : 'date/single'
}

/**
 * Haengen die Monatskarten dieses Dashboards an der BWA?
 *
 * Erkannt am Rueckfall aus MONAT_CTE_BWA -- der ist eindeutig genug, um
 * ihn im SQL wiederzufinden, und aendert sich nur zusammen mit dem
 * Baustein selbst. Eine gepflegte Liste von Dashboardnamen waere beim
 * naechsten Umbau still veraltet.
 *
 * Bewusst STRENG: nur wenn ALLE Monatskarten der Seite an der BWA haengen.
 * Eine gemischte Seite bekommt die Standardvorgabe, weil dort die Mehrheit
 * der Karten sonst leer bliebe -- und eine einzelne leere BWA-Karte ist
 * der kleinere Schaden als eine ganze leere Seite.
 */
function bwaDashboard(d: Dashboard): boolean {
  const karten: Karte[] = []
  for (const r of reihenVon(d)) {
    for (const t of r.teile) {
      if (!t.karte) continue
      const k = alleKarten.find(x => x.schluessel === t.karte)
      if (k && /\{\{\s*monat\s*\}\}/.test(k.sql)) karten.push(k)
    }
  }
  if (karten.length === 0) return false
  return karten.every(k =>
    k.sql.includes('mart.kennzahlen_aktuell') && k.sql.includes('wert_absolut <> 0'))
}

function templateTags(karte: Karte) {
  const tags: Record<string, unknown> = {}
  const namen = new Set<string>()
  for (const t of karte.sql.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) namen.add(t[1]!)

  for (const name of namen) {
    const p = karte.parameter?.find(x => x.name === name)
    const dim = karte.template_tag_dimension?.[name]
    if (dim) {
      tags[name] = {
        id: `tag-${karte.schluessel}-${name}`,
        name,
        'display-name': p?.['display-name'] ?? name,
        type: 'dimension',
        'widget-type': 'date/all-options',
        // Platzhalter, wird in der Seite gegen die echte Feld-ID getauscht.
        dimension: ['field', { __feld: dim }, null],
        default: null,
      }
    } else {
      // Ein Datumsparameter hat ZWEI Typangaben, und sie muessen
      // zusammenpassen: `type` sagt, was fuer eine Variable es ist (date),
      // `widget-type` sagt, welches Bedienfeld dazu gehoert
      // (date/month-year, date/single ...).
      //
      // Ohne `widget-type` nimmt Metabase 'date' an. Auf einem Dashboard
      // faellt das nicht auf -- dort gleicht es die beiden Seiten ab. Ruft
      // man dieselbe Karte aber ALLEIN auf, was jeder Klick auf einen
      // Balken tut, prueft Metabase streng und antwortet mit 500:
      //   "Invalid parameter value type :date/month-year for parameter
      //    monat with widget type :date"
      // Im Browser steht dann "We're experiencing server issues" -- eine
      // Meldung, die nach einem kaputten Server aussieht und keinen
      // Hinweis auf die eigentliche Ursache gibt.
      // Gemeldet am 27.07.2026 fuer die Balken des Round Table.
      const istDatum = p?.type?.startsWith('date') ?? false
      tags[name] = {
        id: `tag-${karte.schluessel}-${name}`,
        name,
        'display-name': p?.['display-name'] ?? name,
        type: istDatum ? 'date' : 'text',
        ...(istDatum && p!.type !== 'date' ? { 'widget-type': p!.type } : {}),
        required: p?.required ?? false,
        default: p?.default ?? null,
      }
    }
  }
  return tags
}

const definitionen = {
  db_id: DB_ID,
  karten: alleKarten.map(karte => ({
    schluessel: karte.schluessel,
    hat_feldfilter: !!karte.template_tag_dimension,
    payload: {
      name: karte.name,
      description: `${karte.beschreibung}\n\n[key:${karte.schluessel}]`,
      display: karte.anzeige,
      visualization_settings: karte.visualisierung ?? {},
      dataset_query: {
        type: 'native',
        database: DB_ID,
        native: { query: karte.sql.trim(), 'template-tags': templateTags(karte) },
      },
      parameters: (karte.parameter ?? []).map(p => ({
        id: p.id,
        name: p.name,
        slug: p.name,
        // Der Typ der KARTE ist nicht der Typ des Dashboardfilters.
        //
        // Eine Variable im nativen SQL ist fuer Metabase vom Typ `date`,
        // und dagegen prueft es beim Ausfuehren streng. Erlaubt sind nur
        // :category, :date und :date/single -- nachgemessen, indem alle
        // vier Varianten gegen dieselbe Karte geschickt wurden:
        // date/single, date und category liefern 6 Zeilen,
        // date/month-year antwortet mit 500.
        //
        // Auf dem Dashboard faellt das nie auf, weil dort abgeglichen
        // wird. Ruft man die Karte ALLEIN auf -- und genau das tut jeder
        // Klick auf einen Balken --, scheitert sie mit "We're experiencing
        // server issues". Betroffen waren 50 der 120 Karten.
        //
        // Das Bedienfeld leidet nicht darunter: welches Feld angezeigt
        // wird, entscheidet `widget-type` am template-tag, und das bleibt
        // date/month-year. Gemeldet am 27.07.2026.
        type: karte.template_tag_dimension?.[p.name]
          ? p.type                        // Feldfilter: haengt an einer Spalte, darf alles
          : kartenParameterTyp(p.type),   // Variable: nur was Metabase durchlaesst
        target: karte.template_tag_dimension?.[p.name]
          ? ['dimension', ['template-tag', p.name]]
          : ['variable', ['template-tag', p.name]],
      })),
    },
  })),
  dashboards: dashboards.map(d => ({
    schluessel: d.schluessel,
    sammlung: d.sammlung,
    // Haengen die Karten dieser Seite an der BWA? Dann braucht ihr
    // Monatsfilter den letzten GEBUCHTEN Monat als Vorgabe, nicht den
    // letzten bewerteten -- der Steuerberater hinkt ein bis zwei Monate
    // hinterher.
    //
    // Abgeleitet aus dem SQL statt von Hand gepflegt: eine Liste von
    // Dashboardnamen waere beim naechsten Umbau still veraltet, und der
    // Fehler saehe aus wie fehlende Daten. Erkennungsmerkmal ist der
    // Rueckfall aus MONAT_CTE_BWA.
    bwa_monat: bwaDashboard(d),
    payload: {
      name: d.name,
      description: `${d.beschreibung}\n\n[key:${d.schluessel}]`,
    },
    parameter: (d.filter ?? []).map(p => ({
      id: p.id,
      name: p['display-name'],
      slug: p.name,
      type: p.type,
      sectionId: p.type.startsWith('date') ? 'date' : 'string',
      // Vorgabewert, wo einer in der Definition steht -- etwa die letzten
      // drei Monate in der Warenwirtschaft, die ohne Eingrenzung 14
      // Millionen Zeilen laden wuerde.
      ...(p.default !== undefined ? { default: p.default } : {}),
      // Auswahlliste statt Freitext. Das Feld wird erst in der Seite zur
      // Feld-ID aufgeloest, weil die IDs je Metabase-Installation andere
      // sind und hier nicht fest stehen duerfen.
      ...(p.werteliste ? { werteliste: p.werteliste } : {}),
      ...(p.festeWerte ? { festeWerte: p.festeWerte } : {}),
    })),
    kacheln: layoutVon.get(d.schluessel)!,
    // Reiternamen in Reihenfolge. Die Kacheln tragen den Index (`tab`);
    // die Seite uebersetzt beides in Metabases tabs/dashboard_tab_id.
    tabs: d.tabs?.map(t => t.name) ?? null,
  })),
  sammlungen: [
    {
      name: 'Drill-Down',
      beschreibung:
        'Die Kette Marke → Filiale → Betrieb, dazu der Vergleich von Zeiträumen und Standorten. Hier fängt man an; ein Klick führt jeweils eine Ebene tiefer.',
    },
    {
      name: 'Round Table',
      beschreibung:
        'Alles für den monatlichen Round Table: Übersicht und Betriebstabelle, Trend und Historie, Ursachen und Maßnahmen.',
    },
    {
      name: 'Technik',
      beschreibung:
        'Läuft der Datenimport? Die Seite, die man aufschlägt, wenn Zahlen fehlen — und die einzige, die sagt, woran es liegt.',
    },
    {
      name: 'Betrieb',
      beschreibung:
        'Die Detailauswertungen: Umsatz, Struktur, Personal, Warenwirtschaft und BWA — dazu die Seite, auf der man prüft, ob man den übrigen glauben darf.',
    },
  ],
}

// =====================================================================
// Die Seite, die die Arbeit macht.
// =====================================================================
const SEITE = String.raw`<!doctype html>
<meta charset="utf-8">
<title>Dashboards übernehmen</title>
<style>
  body { font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
         max-width: 60rem; margin: 3rem auto; padding: 0 1.5rem;
         color: #2b2b2b; background: #fbfbfa; }
  h1 { font-size: 1.4rem; }
  #log { white-space: pre-wrap; border-left: 3px solid #ddd; padding-left: 1rem; }
  .ok { color: #2d7a2d; } .neu { color: #1a6ba8; } .fehler { color: #b03030; font-weight: bold; }
  button { font: inherit; padding: .6rem 1.2rem; cursor: pointer; }
</style>
<h1>Dashboards nach Metabase übernehmen</h1>
<p>Legt Sammlungen, Karten und Dashboards an. Ein zweiter Lauf aktualisiert, was schon da ist,
   statt es zu verdoppeln.</p>
<button id="los">Übernehmen</button>
<pre id="log"></pre>
<script>
const log = (t, k='') => {
  const s = document.createElement('span');
  s.className = k; s.textContent = t + '\n';
  document.getElementById('log').append(s);
};

async function mb(pfad, methode='GET', koerper) {
  const r = await fetch('/api' + pfad, {
    method: methode,
    headers: {'Content-Type':'application/json'},
    body: koerper ? JSON.stringify(koerper) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(methode + ' ' + pfad + ' → ' + r.status + ' ' + text.slice(0, 400));
  return text ? JSON.parse(text) : null;
}

async function uebernehmen() {
  const def = await (await fetch('/definitionen.json')).json();

  // --- Feld-IDs für die Feldfilter --------------------------------
  const felder = {};
  for (const f of await mb('/database/' + def.db_id + '/fields')) {
    felder[f.schema + '.' + f.table_name + '.' + f.name] = f.id;
  }
  log('Feldkatalog: ' + Object.keys(felder).length + ' Felder');

  // --- Sammlungen ---------------------------------------------------
  const vorhandeneSammlungen = await mb('/collection');
  const sammlungId = {};
  for (const s of def.sammlungen) {
    const da = vorhandeneSammlungen.find(x => x.name === s.name && !x.archived);
    if (da) { sammlungId[s.name] = da.id; log('Sammlung ' + s.name + ' — vorhanden', 'ok'); }
    else {
      const neu = await mb('/collection', 'POST', {name: s.name, description: s.beschreibung});
      sammlungId[s.name] = neu.id; log('Sammlung ' + s.name + ' — angelegt', 'neu');
    }
  }

  // --- Karten -------------------------------------------------------
  // Gesucht wird über [key:...] in der Beschreibung, nicht über den Namen:
  // Namen darf jemand in der Oberfläche ändern, ohne dass hier eine Kopie
  // entstehen soll.
  const suche = await mb('/search?models=card&archived=false&limit=1000');
  const nachSchluessel = {};
  for (const c of (suche.data || [])) {
    const m = (c.description || '').match(/\[key:([a-z0-9_]+)\]/);
    if (m) nachSchluessel[m[1]] = c.id;
  }

  const karteId = {};
  for (const k of def.karten) {
    const p = JSON.parse(JSON.stringify(k.payload));
    // Feldfilter-Platzhalter gegen echte IDs tauschen.
    for (const tag of Object.values(p.dataset_query.native['template-tags'])) {
      if (tag.dimension && tag.dimension[1] && tag.dimension[1].__feld) {
        const schluessel = tag.dimension[1].__feld.join('.');
        const id = felder[schluessel];
        if (!id) throw new Error('Feld nicht gefunden: ' + schluessel + ' (Karte ' + k.schluessel + ')');
        tag.dimension = ['field', id, null];
      }
    }
    p.collection_id = sammlungId[
      k.schluessel.startsWith('rt_') ? 'Round Table'
      : (k.schluessel.startsWith('dd_') || k.schluessel.startsWith('vg_')
         || k.schluessel.startsWith('pf_')) ? 'Drill-Down'
      : 'Betrieb'];

    const da = nachSchluessel[k.schluessel];
    try {
      if (da) { await mb('/card/' + da, 'PUT', p); karteId[k.schluessel] = da; log('  Karte ' + k.schluessel + ' — aktualisiert', 'ok'); }
      else { const neu = await mb('/card', 'POST', p); karteId[k.schluessel] = neu.id; log('  Karte ' + k.schluessel + ' — angelegt', 'neu'); }
    } catch (e) { log('  Karte ' + k.schluessel + ' — FEHLER: ' + e.message, 'fehler'); }
  }

  // --- Dashboards ---------------------------------------------------
  // Zwei Durchgaenge. Der erste legt alle Dashboards an, damit im zweiten
  // die Ziel-IDs fuer das Klickverhalten bekannt sind — ein Drill-Down
  // zeigt fast immer auf ein Dashboard, das es beim Anlegen noch nicht gab.
  const dsuche = await mb('/search?models=dashboard&archived=false&limit=1000');
  const dashNachSchluessel = {};
  for (const d of (dsuche.data || [])) {
    const m = (d.description || '').match(/\[key:([a-z0-9_]+)\]/);
    if (m) dashNachSchluessel[m[1]] = d.id;
  }

  const dashId = {};
  for (const d of def.dashboards) {
    const grund = {...d.payload, collection_id: sammlungId[d.sammlung]};
    let id = dashNachSchluessel[d.schluessel];
    if (id) { await mb('/dashboard/' + id, 'PUT', grund); log('Dashboard ' + d.payload.name + ' — vorhanden', 'ok'); }
    else { const neu = await mb('/dashboard', 'POST', grund); id = neu.id; log('Dashboard ' + d.payload.name + ' — angelegt', 'neu'); }
    dashId[d.schluessel] = id;
  }

  // Die Werte fuer eine Auswahlliste holen. Ueber Metabases eigene
  // Abfrage-Schnittstelle, damit hier keine zweite Datenbankverbindung
  // noetig ist. Wird je Liste nur einmal gelesen und danach gemerkt.
  const listenSpeicher = {};
  async function werteHolen(feld) {
    const schluessel = feld.join('.');
    if (listenSpeicher[schluessel]) return listenSpeicher[schluessel];
    const [schema, tabelle, spalte] = feld;
    const antwort = await mb('/dataset', 'POST', {
      type: 'native',
      database: def.db_id,
      native: {query:
        'SELECT DISTINCT "' + spalte + '" FROM "' + schema + '"."' + tabelle + '" ' +
        'WHERE "' + spalte + '" IS NOT NULL ORDER BY 1'},
    });
    const werte = (antwort.data?.rows || []).map(r => r[0]).filter(v => v !== null && v !== '');
    listenSpeicher[schluessel] = werte;
    log('  Auswahlliste ' + schluessel + ': ' + werte.length + ' Werte');
    return werte;
  }

  // Den voreingestellten Monat holen: den juengsten, fuer den ueberhaupt
  // ein Urteil vorliegt. Ueber Metabases eigene Abfrageschnittstelle, damit
  // die Seite keine zweite Datenbankverbindung braucht.
  //
  // Scheitert das, bleibt vorgabeMonat leer und die Filter stehen wie
  // bisher ohne Vorgabe da -- die Dashboards rechnen dann weiter mit dem
  // Rueckfall aus MONAT_CTE. Schlechter als vorher wird es dadurch nicht.
  // ZWEI Vorgabemonate, und das ist kein Schoenheitsfehler.
  //
  // Der Round Table traegt den juengsten GEBUCHTEN BWA-Monat in spaetere
  // Berichtsmonate nach -- er hat fuer Juli ein Urteil, obwohl der
  // Steuerberater den Juli noch nicht gebucht hat. Eine EBIT-Karte kann
  // das nicht: sie zeigt den Monat selbst, und fuer Juli gibt es ihn
  // nicht.
  //
  // Der erste Wurf setzte ueberall denselben Monat und machte damit genau
  // den Fehler, vor dem der Kommentar an MONAT_CTE_BWA warnt: die Karte
  // "EBIT je Betrieb" war leer, obwohl 23 Betriebe gebuchte Juni-Zahlen
  // haben. Gemeldet am 27.07.2026.
  //
  // Die Vorgabe muss deshalb zu dem Rueckfall passen, den die Karten der
  // Seite benutzen -- sonst widerspricht sie ihm.
  const vorgabe = {};
  for (const [name, sql] of [
    // Der juengste ABGESCHLOSSENE Monat — nicht der laufende Teilmonat.
    // Begruendung am MONAT_CTE in gemeinsam.ts; src/sync/auswahllisten.ts
    // setzt denselben Wert nach jedem Import.
    ['standard', "SELECT to_char(max(monat), 'YYYY-MM') FROM mart.round_table_monat " +
                 "WHERE monat < date_trunc('month', current_date)::date AND gesamt IS NOT NULL"],
    ['bwa',      "SELECT to_char(max(monat), 'YYYY-MM') FROM mart.kennzahlen_aktuell " +
                 "WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0"],
  ]) {
    try {
      const a = await mb('/dataset', 'POST', {
        type: 'native', database: def.db_id, native: {query: sql}});
      vorgabe[name] = (a.data?.rows || [])[0]?.[0] ?? null;
    } catch (e) { log('Vorgabemonat ' + name + ' nicht ermittelbar: ' + e.message, 'fehler'); }
  }
  log('Voreingestellter Monat: ' + (vorgabe.standard ?? '(keiner)') +
      ', bei der BWA ' + (vorgabe.bwa ?? '(keiner)'));

  // Klickverhalten einer Kachel in Metabases Struktur uebersetzen.
  // parameterMapping bildet einen Parameter des ZIELS auf eine Spalte der
  // QUELLE ab; ohne diese Abbildung oeffnet der Klick das Zieldashboard
  // ungefiltert, was schlimmer ist als kein Klick.
  function klickVerhalten(k, zielDashboard, quellDashboard) {
    // FESTER WERT -> eigene URL.
    //
    // Eine Zaehlkachel hat keine Spalte, aus der sich etwas mitgeben
    // liesse -- sie weiss aber, was sie zaehlt. Der erste Versuch setzte
    // dafuer parameterMapping mit source: null und einem value-Feld. Das
    // speichert Metabase klaglos und IGNORIERT es dann: die Kachel war im
    // Browser gar nicht anklickbar, gemeldet am 27.07.2026.
    //
    // Metabase erwartet in parameterMapping.source immer eine echte
    // Spalte. Fuer feste Werte ist der vorgesehene Weg eine Ziel-URL mit
    // dem Filter in der Abfragezeichenfolge -- genau das, was die
    // Oberflaeche selbst erzeugt, wenn man "Benutzerdefinierte URL" waehlt.
    if (k.fest) {
      // Fester Wert -> Ziel-URL. Die durchgereichten Filter kommen als
      // Platzhalter dazu: Metabase ersetzt {{slug}} in einem linkTemplate
      // durch den aktuellen Wert des gleichnamigen Dashboard-Filters. So
      // behaelt "9 rote Betriebe" beim Klick auch Monat und Marke.
      const paare = Object.entries(k.uebergabe)
        .map(([slug, wert]) => encodeURIComponent(slug) + '=' + encodeURIComponent(wert));
      for (const slug of (k.durchreichen || [])) {
        paare.push(encodeURIComponent(slug) + '={{' + slug + '}}');
      }
      return {
        type: 'link',
        linkType: 'url',
        linkTemplate: '/dashboard/' + zielDashboard + (paare.length ? '?' + paare.join('&') : ''),
      };
    }

    const zielDef = def.dashboards.find(x => x.schluessel === k.ziel);
    const quellDef = def.dashboards.find(x => x.schluessel === quellDashboard);
    const parameterMapping = {};
    for (const [zielSlug, quellSpalte] of Object.entries(k.uebergabe)) {
      const zp = (zielDef.parameter || []).find(p => p.slug === zielSlug);
      if (!zp) { log('  Klickziel ' + k.ziel + ' hat keinen Filter ' + zielSlug, 'fehler'); continue; }
      parameterMapping[zp.id] = {
        id: zp.id,
        source: {type: 'column', id: quellSpalte, name: quellSpalte},
        target: {type: 'parameter', id: zp.id},
      };
    }
    // Durchgereichte Filter: Quelle ist nicht eine Spalte der Karte,
    // sondern der gleichnamige Filter des Quell-Dashboards. Metabase
    // unterscheidet das ueber source.type -- 'parameter' statt 'column'.
    for (const slug of (k.durchreichen || [])) {
      const zp = (zielDef.parameter || []).find(p => p.slug === slug);
      const qp = (quellDef.parameter || []).find(p => p.slug === slug);
      if (!zp || !qp) continue;
      parameterMapping[zp.id] = {
        id: zp.id,
        source: {type: 'parameter', id: qp.id, name: qp.name},
        target: {type: 'parameter', id: zp.id},
      };
    }
    return {type: 'link', linkType: 'dashboard', targetId: zielDashboard, parameterMapping};
  }

  for (const d of def.dashboards) {
    let id = dashId[d.schluessel];
    try {
      // Kacheln. Jede Karte, die einen gleichnamigen Parameter hat, wird
      // an den Dashboard-Filter verdrahtet — sonst bliebe der Filter oben
      // stehen und täte nichts.
      // Reiter: negative IDs, die Metabase beim Anlegen durch echte ersetzt.
      // Kacheln verweisen ueber dashboard_tab_id auf dieselben negativen IDs.
      // Ohne Reiter wird tabs: [] geschickt — das raeumt auch Reiter ab, die
      // ein frueherer Stand angelegt hat.
      const tabs = (d.tabs || []).map((name, i) => ({id: -(i + 1), name}));
      const tabId = (kachel) =>
        kachel.tab !== undefined && kachel.tab !== null ? -(kachel.tab + 1) : undefined;
      const dashcards = [];
      let lauf = -1;
      for (const kachel of d.kacheln) {
        lauf -= 1;
        if (kachel.text) {
          dashcards.push({
            id: lauf, card_id: null, row: kachel.y, col: kachel.x,
            size_x: kachel.breite, size_y: kachel.hoehe,
            ...(tabId(kachel) !== undefined ? {dashboard_tab_id: tabId(kachel)} : {}),
            visualization_settings: {virtual_card: {name: null, display: 'text',
              visualization_settings: {}, dataset_query: {}, archived: false},
              text: kachel.text, 'text.align_vertical': 'middle'},
            parameter_mappings: [],
          });
          continue;
        }
        const cid = karteId[kachel.karte];
        if (!cid) { log('  Kachel ohne Karte übersprungen: ' + kachel.karte, 'fehler'); continue; }
        const kdef = def.karten.find(x => x.schluessel === kachel.karte);
        const tags = kdef.payload.dataset_query.native['template-tags'];
        const mappings = [];
        for (const p of d.parameter) {
          if (!tags[p.slug]) continue;
          mappings.push({
            parameter_id: p.id, card_id: cid,
            target: tags[p.slug].type === 'dimension'
              ? ['dimension', ['template-tag', p.slug]]
              : ['variable', ['template-tag', p.slug]],
          });
        }
        // Klickverhalten: ohne spalte fuer die ganze Karte, mit
        // spalte nur fuer diese eine Tabellenspalte.
        const vis = {};
        for (const k of (kachel.klick || [])) {
          const ziel = dashId[k.ziel];
          if (!ziel) { log('  Klickziel unbekannt: ' + k.ziel, 'fehler'); continue; }
          if (k.spalte) {
            vis.column_settings = vis.column_settings || {};
            const schluessel = JSON.stringify(['name', k.spalte]);
            vis.column_settings[schluessel] = {
              ...(vis.column_settings[schluessel] || {}),
              click_behavior: klickVerhalten(k, ziel, d.schluessel),
            };
          } else {
            vis.click_behavior = klickVerhalten(k, ziel, d.schluessel);
          }
        }
        // Spaltenformate der Karte beibehalten, Klickverhalten ergaenzen.
        const kdefVis = kdef.payload.visualization_settings || {};
        if (kdefVis.column_settings && vis.column_settings) {
          vis.column_settings = {...kdefVis.column_settings, ...vis.column_settings};
          for (const sp of Object.keys(vis.column_settings)) {
            if (kdefVis.column_settings[sp]) {
              vis.column_settings[sp] = {...kdefVis.column_settings[sp], ...vis.column_settings[sp]};
            }
          }
        }
        dashcards.push({
          id: lauf, card_id: cid, row: kachel.y, col: kachel.x,
          size_x: kachel.breite, size_y: kachel.hoehe,
          ...(tabId(kachel) !== undefined ? {dashboard_tab_id: tabId(kachel)} : {}),
          parameter_mappings: mappings, visualization_settings: vis,
        });
      }

      // Auswahllisten setzen. Ohne sie zeigt Metabase ein Freitextfeld:
      // wer "Enchilada Bremen" nicht auf den Buchstaben genau trifft, sieht
      // ein leeres Dashboard und keinen Hinweis, dass der Filter schuld ist.
      //
      // Bewusst eine FESTE Liste und kein Verweis auf ein Feld: die Karten
      // sind natives SQL, ihre Filter haengen deshalb an einer Variablen und
      // nicht an einer Spalte. Metabase bietet ein Feld-Dropdown nur dort an,
      // wo es die Spalte kennt — bei einer Variablen bleibt es beim
      // Freitextfeld, egal was in values_source_config steht.
      const parameter = [];
      for (const p of d.parameter) {
        // Der Monatsfilter bekommt den juengsten bewerteten Monat als
        // Vorgabe. Ohne sie steht der Filter leer, und man sieht nicht,
        // welchen Monat man gerade liest -- gerechnet wird trotzdem einer,
        // weil MONAT_CTE zurueckfaellt.
        //
        // Ein RELATIVER Wert waere haltbarer gewesen, funktioniert aber
        // nicht: bei einer SQL-Variablen kommt 'thismonth' unveraendert an
        // und 'thismonth'::date scheitert. Nachgemessen am 27.07.2026 --
        // alle Kacheln meldeten daraufhin einen Fehler.
        //
        // Der feste Wert veraltet am Monatsersten. Dagegen setzt ihn
        // src/sync/auswahllisten.ts nach JEDEM Import neu; hier steht er,
        // damit eine frisch eingerichtete Metabase nicht bis zum ersten
        // Sync-Lauf ohne Vorgabe dasteht.
        if (p.slug === 'monat' && p.type === 'date/month-year') {
          const wert = d.bwa_monat ? vorgabe.bwa : vorgabe.standard;
          if (wert) { parameter.push({...p, default: wert}); continue; }
        }
        // Feste Liste: Werte stehen in der Definition, nicht in der
        // Datenbank -- etwa die Bewertung, deren 'ohne' fuer NULL steht.
        if (p.festeWerte) {
          const {festeWerte, werteliste: _w, ...rest} = p;
          parameter.push({
            ...rest,
            values_query_type: 'list',
            values_source_type: 'static-list',
            values_source_config: {values: festeWerte},
          });
          continue;
        }
        if (!p.werteliste) { parameter.push(p); continue; }
        const {werteliste, ...rest} = p;
        const werte = await werteHolen(werteliste);
        if (!werte.length) {
          log('  Werteliste ' + werteliste.join('.') + ' leer', 'fehler');
          parameter.push(rest); continue;
        }
        parameter.push({
          ...rest,
          values_query_type: 'list',
          values_source_type: 'static-list',
          values_source_config: {values: werte},
        });
      }

      await mb('/dashboard/' + id, 'PUT', {parameters: parameter, dashcards, tabs});
      log('  ' + dashcards.length + ' Kacheln gesetzt'
          + (tabs.length ? ' (' + tabs.length + ' Reiter)' : ''), 'ok');
    } catch (e) { log('Dashboard ' + d.payload.name + ' — FEHLER: ' + e.message, 'fehler'); }
  }

  // --- Verwaiste Dashboards aufraeumen -------------------------------
  //
  // Ein Dashboard, das aus dashboards.ts entfernt wurde, blieb bisher in
  // Metabase stehen. Aufgefallen am 27.07.2026 beim Zusammenlegen von
  // "① Marken" in den Round Table: die alte Seite war weiterhin da, mit
  // denselben Karten, und niemand haette gemerkt, dass sie nicht mehr
  // gepflegt wird.
  //
  // Erkannt werden sie am [key:...] in der Beschreibung -- das setzt nur
  // dieses Skript. Von Hand angelegte Dashboards tragen keinen und bleiben
  // deshalb unangetastet.
  //
  // ARCHIVIERT, NICHT GELOESCHT: Archivieren ist in Metabase umkehrbar,
  // Loeschen nicht. Wer sich vertut, holt die Seite im Papierkorb zurueck.
  try {
    const gewollt = new Set(def.dashboards.map(d => d.schluessel));
    const alle = await mb('/search?models=dashboard&archived=false&limit=1000');
    for (const d of (alle.data || [])) {
      const m = (d.description || '').match(/\[key:([a-z0-9_]+)\]/);
      if (!m || gewollt.has(m[1])) continue;
      await mb('/dashboard/' + d.id, 'PUT', {archived: true});
      log('Dashboard ' + d.name + ' — archiviert (nicht mehr in dashboards.ts)', 'neu');
    }

    // Metabases mitgeliefertes Beispiel. Es steht in der Sammlung
    // "Examples" und zeigt erfundene Verkaufszahlen -- neben echten
    // Dashboards ist das eine Verwechslungsgefahr, und zwar eine, die
    // niemand vermutet, weil es aussieht wie eine unserer Seiten.
    for (const d of (alle.data || [])) {
      const istBeispiel = /^E-commerce Insights$/.test(d.name || '')
        && /sample data|hypothetical/i.test(d.description || '');
      if (!istBeispiel) continue;
      await mb('/dashboard/' + d.id, 'PUT', {archived: true});
      log('Beispiel-Dashboard "' + d.name + '" archiviert (Metabase-Demodaten)', 'neu');
    }
  } catch (e) { log('Aufraeumen fehlgeschlagen: ' + e.message, 'fehler'); }

  // --- Beschreibungen aus COMMENT ON nachziehen ----------------------
  //
  // Metabase liest die Kommentare der Datenbank NUR, wenn es eine Tabelle
  // oder ein Feld zum ersten Mal sieht. Aendert eine Migration den Text
  // spaeter, bleibt in der Oberflaeche die alte Fassung stehen -- ein
  // Sync raeumt das nicht ab, und ueber die Datenbank ist sie nicht mehr
  // erreichbar.
  //
  // Aufgefallen am 12.08.2026: nach der Umbenennung Haus -> Betrieb
  // standen die Spaltennamen sofort richtig da (die zieht der Sync), die
  // Info-Fenster an den Tabellen dagegen trugen weiter "Haeuser" --
  // sechs Wochen alter Text, den 0066 in der Datenbank laengst ersetzt
  // hatte.
  //
  // Gelesen wird ueber /api/dataset, nicht ueber eine eigene
  // Datenbankverbindung: dieses Skript soll genau die Bank sehen, an der
  // Metabase haengt. Eine zweite Verbindung ueber DATABASE_URL zeigte
  // hier auf die Entwicklungsbank und haette den falschen Stand
  // uebertragen.
  try {
    // Kein Backtick in diesem Block: der ganze Seitentext ist selbst ein
    // Template-Literal, ein zweites darin beendet es vorzeitig.
    const KOMMENTARE = [
      "SELECT n.nspname, c.relname, '' AS spalte, obj_description(c.oid,'pg_class') AS text",
      "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace",
      " WHERE c.relkind IN ('r','v','m','p')",
      "   AND obj_description(c.oid,'pg_class') IS NOT NULL",
      "UNION ALL",
      "SELECT n.nspname, c.relname, a.attname, col_description(c.oid, a.attnum)",
      "  FROM pg_class c",
      "  JOIN pg_namespace n ON n.oid = c.relnamespace",
      "  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped",
      " WHERE c.relkind IN ('r','v','m','p')",
      "   AND col_description(c.oid, a.attnum) IS NOT NULL",
    ].join('\n');

    const antwort = await mb('/dataset', 'POST',
      {database: def.db_id, type: 'native', native: {query: KOMMENTARE}});
    if (antwort.status === 'failed') throw new Error(antwort.error);

    const kommentar = {};
    for (const [schema, tabelle, spalte, text] of antwort.data.rows) {
      kommentar[schema + '.' + tabelle + '.' + spalte] = text;
    }

    const meta = await mb('/database/' + def.db_id + '/metadata');
    let gesetzt = 0;
    for (const t of (meta.tables || [])) {
      const tk = kommentar[t.schema + '.' + t.name + '.'];
      if (tk && tk !== t.description) {
        await mb('/table/' + t.id, 'PUT', {description: tk});
        gesetzt++;
      }
      for (const f of (t.fields || [])) {
        const fk = kommentar[t.schema + '.' + t.name + '.' + f.name];
        if (fk && fk !== f.description) {
          await mb('/field/' + f.id, 'PUT', {description: fk});
          gesetzt++;
        }
      }
    }
    log('  ' + gesetzt + ' Beschreibungen aus COMMENT ON nachgezogen', gesetzt ? 'neu' : 'ok');
  } catch (e) { log('Beschreibungen nachziehen fehlgeschlagen: ' + e.message, 'fehler'); }

  log('\nFertig.');
}

document.getElementById('los').onclick = async () => {
  document.getElementById('los').disabled = true;
  try { await uebernehmen(); } catch (e) { log('ABBRUCH: ' + e.message, 'fehler'); }
};
</script>`

// =====================================================================
// Server: Seite, Definitionen, und alles unter /api an Metabase weiter.
// =====================================================================
// =====================================================================
// Direkter Weg: selbst anmelden und dieselbe Logik hier ausführen.
//
// Der Proxy unten existiert, weil Metabase eine strenge
// Content-Security-Policy schickt — seine eigene Seite darf keine
// Anfragen nach aussen stellen, also lief das Skript IM Browser und
// benutzte das Sitzungs-Cookie des angemeldeten Menschen. Damit brauchte
// jede Uebernahme jemanden, der einen Browser oeffnet.
//
// Metabase hat aber einen API-Login. Mit einem eigenen Konto
// (METABASE_USER/_PASSWORD) laeuft die Uebernahme ohne Browser und
// spaeter auch auf dem Server.
//
// WARUM DERSELBE CODE UND KEINE ZWEITE FASSUNG: die 391 Zeilen in SEITE
// sind die einzige Wahrheit darueber, wie Karten und Dashboards angelegt
// werden. Eine zweite Fassung waere ab dem ersten Tag eine Kopie, die
// hinterherhinkt. Stattdessen wird die Funktion `uebernehmen()` aus der
// Seite herausgeschnitten und hier mit serverseitigem `mb`, `log` und
// `def` ausgefuehrt.
// =====================================================================
async function direktUebernehmen(user: string, passwort: string): Promise<number> {
  const anmeldung = await fetch(`${METABASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: passwort }),
  })
  if (!anmeldung.ok) {
    const text = await anmeldung.text()
    console.error(`Anmeldung an Metabase gescheitert (${anmeldung.status}): ${text.slice(0, 300)}`)
    console.error('  Passwortlänge:', passwort.length, '— Benutzer:', user)
    return 1
  }
  const { id: sitzung } = await anmeldung.json() as { id: string }

  /** Ein Aufruf gegen Metabase, mit der eigenen Sitzung. */
  const mb = async (pfad: string, methode = 'GET', koerper?: unknown) => {
    const r = await fetch(METABASE + '/api' + pfad, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Metabase-Session': sitzung },
      body: koerper ? JSON.stringify(koerper) : undefined,
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`${methode} ${pfad} → ${r.status} ${text.slice(0, 400)}`)
    return text ? JSON.parse(text) : null
  }

  let fehler = 0
  const log = (t: string, k = '') => {
    if (k === 'fehler') fehler++
    console.log(t)
  }

  /**
   * Die Funktion aus der Seite holen. Sie steht dort zwischen
   * `async function uebernehmen()` und dem Klick-Handler; alles davor
   * (der Browser-`log`, der Browser-`mb`) wird hier durch die Fassungen
   * oben ersetzt.
   */
  const anfang = SEITE.indexOf('async function uebernehmen()')
  const ende = SEITE.indexOf("document.getElementById('los').onclick")
  if (anfang < 0 || ende < 0) {
    console.error('uebernehmen() nicht in der Seite gefunden — wurde SEITE umgebaut?')
    return 1
  }
  /**
   * Eine Zeile muss weichen: `const def = await (await
   * fetch('/definitionen.json')).json()` holt die Definitionen im
   * Browser über den Proxy. Hier kommen sie direkt als Parameter — die
   * Zeile würde eine relative URL anfragen, die es ohne Server nicht
   * gibt. Bewusst eine gezielte Ersetzung und kein Umbau der Seite:
   * schlägt sie fehl, bricht der Lauf sichtbar ab, statt still eine
   * andere Definition zu verwenden.
   */
  const quelle = SEITE.slice(anfang, ende).replace(
    /const def = await \(await fetch\('\/definitionen\.json'\)\)\.json\(\);?/,
    '/* def kommt als Parameter */')

  const laufen = new Function('mb', 'log', 'def', `
    ${quelle}
    return uebernehmen()
  `) as (mb: unknown, log: unknown, def: unknown) => Promise<void>

  try {
    await laufen(mb, log, definitionen)
  } catch (e) {
    console.error('ABBRUCH:', e instanceof Error ? e.message : String(e))
    return 1
  }
  return fehler > 0 ? 1 : 0
}

// Zugangsdaten da? Dann direkt. Sonst der Proxy wie bisher — wer nichts
// konfiguriert hat, verliert nichts.
if (config.METABASE_USER && config.METABASE_PASSWORD) {
  console.log(`Übernahme direkt gegen ${METABASE} als ${config.METABASE_USER}`)
  console.log(`  ${definitionen.karten.length} Karten, ${definitionen.dashboards.length} Dashboards`)
  const code = await direktUebernehmen(config.METABASE_USER, config.METABASE_PASSWORD)
  process.exit(code)
}

const server = Bun.serve({
  port: PORT,
  hostname: 'localhost',
  idleTimeout: 240,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/') {
      return new Response(SEITE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/definitionen.json') {
      return new Response(JSON.stringify(definitionen), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }
    if (url.pathname.startsWith('/api/')) {
      // Unveraendert weiterreichen, samt Cookie. Der Browser schickt es
      // von selbst mit, weil Cookies je Host und nicht je Port gelten.
      const ziel = METABASE + url.pathname + url.search
      const kopf = new Headers(req.headers)
      kopf.set('host', 'localhost:3000')
      kopf.delete('origin')
      kopf.delete('referer')
      const antwort = await fetch(ziel, {
        method: req.method,
        headers: kopf,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
        redirect: 'manual',
      })
      const raus = new Headers(antwort.headers)
      raus.delete('content-security-policy')
      raus.delete('content-encoding')
      raus.delete('content-length')
      return new Response(await antwort.arrayBuffer(), { status: antwort.status, headers: raus })
    }
    return new Response('nichts hier', { status: 404 })
  },
})

console.log(`Bereit auf http://localhost:${server.port}/`)
console.log(`  ${definitionen.karten.length} Karten, ${definitionen.dashboards.length} Dashboards`)
