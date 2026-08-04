// =====================================================================
// Die Dashboards.
//
// Hier steht nur, WAS nebeneinander gehoert — nicht, wo es landet. Eine
// `reihe` ist eine waagerechte Gruppe; layout.ts rechnet daraus x, y,
// Breite und Hoehe. Der Grund ist ein konkreter Fehler: von Hand
// gepflegte y-Werte halten genau bis zur ersten Hoehenaenderung weiter
// oben, danach schiebt sich alles darunter ineinander. Metabase nimmt das
// klaglos entgegen, und im Browser sieht es dann aus wie ein
// Darstellungsproblem statt wie eine falsche Zahl in der Definition.
//
// Anordnungsgrundsatz: oben steht, was man in drei Sekunden sehen will;
// darunter das, was man aufklappt, wenn oben etwas auffaellt.
// =====================================================================

import type { Dashboard, Parameter } from './typen'

const F_MONAT: Parameter = {
  id: 'd-monat', name: 'monat', 'display-name': 'Monat', type: 'date/month-year',
}
// Die drei Textfilter bekommen eine Auswahlliste. Ohne sie zeigt Metabase
// ein Freitextfeld — und ein Tippfehler im Betriebsnamen fuehrt nicht zu
// einer Fehlermeldung, sondern zu einem leeren Dashboard, das aussieht wie
// ein Betrieb ohne Geschaeft.
const F_MARKE: Parameter = {
  id: 'd-marke', name: 'marke', 'display-name': 'Marke', type: 'string/=',
  werteliste: ['mart', 'konzept_zuordnung', 'hauptkonzept'],
}
const F_BETRIEB: Parameter = {
  id: 'd-betrieb', name: 'betrieb', 'display-name': 'Betrieb', type: 'string/=',
  werteliste: ['mart', 'betrieb', 'betrieb'],
}
// Bewertung als Auswahlliste. Feste Werte statt Datenquelle: es gibt genau
// diese vier, und "ohne" steht fuer NULL -- das liefert keine Spalte.
const F_AMPEL: Parameter = {
  id: 'd-ampel', name: 'ampel', 'display-name': 'Bewertung', type: 'string/=',
  // Feste Liste statt Datenquelle: es gibt genau diese vier, und 'ohne'
  // steht fuer NULL -- das liefert keine Spalte.
  festeWerte: ['rot', 'orange', 'gruen', 'ohne'],
}
// Der Bereich einer Einzelampel. Zusammen mit der Bewertung beschreibt er
// genau ein Segment eines gestapelten Balkens -- "Personal / rot".
const F_BEREICH: Parameter = {
  id: 'd-bereich', name: 'bereich', 'display-name': 'Bereich', type: 'string/=',
  festeWerte: ['Umsatz', 'Personal', 'WE Bar', 'WE Küche', 'Online-Bewertung', 'OM vor Ort'],
}
// Der Handlungsbedarf. Trennt die roten Betriebe danach, WIE VIELE
// Bereiche rot sind -- eine rote Ampel heisst handeln, zwei eskalieren.
const F_INTENSITAET: Parameter = {
  id: 'd-intensitaet', name: 'intensitaet', 'display-name': 'Handlungsbedarf', type: 'string/=',
  festeWerte: ['Sofort eskalieren', 'Sofort handeln', 'Nachforschung', 'Beobachten/OK'],
}
const F_ZEITRAUM: Parameter = {
  id: 'd-zeitraum', name: 'zeitraum', 'display-name': 'Zeitraum', type: 'date/all-options',
}

/**
 * Derselbe Filter, aber mit Vorgabe -- fuer die Warenwirtschaft.
 *
 * mart.artikelverkauf hat 14 Millionen Zeilen ueber dreieinhalb Jahre; ein
 * blosses count(*) darauf braucht 20 Sekunden. Ohne Eingrenzung baute die
 * Seite deshalb praktisch nicht auf, und wer ueber den Drill-Down dorthin
 * kam, sah eine haengende Seite statt Zahlen. Gemeldet am 28.07.2026.
 *
 * `past3months` ist ein RELATIVER Wert und veraltet deshalb nie. Das geht
 * hier, weil `zeitraum` ein Feldfilter ist: Metabase baut die Klausel
 * selbst und rechnet den Ausdruck aus. Bei einer SQL-Variablen -- wie beim
 * Monatsfilter -- kaeme das Wort unveraendert an und scheiterte.
 * Nachgemessen: 50 Zeilen in 2 Sekunden statt 20+.
 *
 * Es ist eine VORGABE, keine Grenze. Wer weiter zurueck will, stellt den
 * Filter um.
 */
const F_ZEITRAUM_QUARTAL: Parameter = {
  id: 'd-zeitraum', name: 'zeitraum', 'display-name': 'Zeitraum', type: 'date/all-options',
  default: 'past3months',
}

/**
 * Zeitraum fuer die Betriebsseite -- gleiche Vorgabe, eigener Zweck.
 *
 * Auf ③ Betrieb stehen ein Monatsfilter (fuer die Ampeln) und ein
 * Zeitraumfilter (fuer die Verlaeufe) nebeneinander. Ohne Vorgabe zeigten
 * "wovon dieser Betrieb lebt", Zeitzonen und Tagesverlauf dreieinhalb
 * Jahre am Stueck -- der Monat oben blieb wirkungslos, weil ein Verlauf
 * keinen Stichmonat lesen kann.
 *
 * Drei Monate, weil ein Tagesprofil daraus schon einen Rhythmus zeigt und
 * ein einzelner Monat zu sehr an Feiertagen und Wetter haengt. Eine
 * VORGABE, keine Grenze: wer weiter zurueck will, stellt sie um.
 */
const F_ZEITRAUM_DREI_MONATE: Parameter = {
  id: 'd-zeitraum', name: 'zeitraum', 'display-name': 'Zeitraum', type: 'date/all-options',
  default: 'past3months',
}

// Vier einzelne Datumsfelder fuer den Zeitraumvergleich. Bewusst nicht
// zwei Bereichsfilter: Metabase kann einen Bereichsfilter nur EINEM
// Zeitraum zuordnen, hier brauchen beide Seiten ihren eigenen.
const F_VON_A: Parameter = { id: 'd-von-a', name: 'von_a', 'display-name': 'A von', type: 'date/single' }
const F_BIS_A: Parameter = { id: 'd-bis-a', name: 'bis_a', 'display-name': 'A bis', type: 'date/single' }
const F_VON_B: Parameter = { id: 'd-von-b', name: 'von_b', 'display-name': 'B von', type: 'date/single' }
const F_BIS_B: Parameter = { id: 'd-bis-b', name: 'bis_b', 'display-name': 'B bis', type: 'date/single' }

export const dashboards: Dashboard[] = [
  // ===================================================================
  // DIE DRILL-DOWN-KETTE — Marke → Filiale → Betrieb
  // ===================================================================
  // Das Dashboard "① Marken" gab es bis zum 27.07.2026 als eigene Seite.
  // Es ist aufgegangen im Round Table, der jetzt die Einstiegsebene ① ist:
  // vom Round Table kam man zwar auf die Filialen, aber die Markenebene
  // dazwischen fehlte, und eine eigene Seite dafuer war ein Umweg fuer
  // etwas, das in dieselbe Frage gehoert.
  // sichtbarkeit.ts raeumt die verwaiste Seite in Metabase auf.

  {
    schluessel: 'dd_filialen',
    name: '② Filialen',
    beschreibung:
      'Alle Betriebe — oder nur die einer Marke, wenn man von Ebene ① kommt — über sämtliche Kennzahlen mit Ampeln. Ein Klick auf den Betriebsnamen öffnet die Detailseite.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_MARKE, F_AMPEL, F_BEREICH, F_INTENSITAET],
    reihen: [
      { teile: [{ text: '# ② Filialen\n\nKlick auf den Betriebsnamen öffnet die Detailseite. ⚪ heißt **keine Daten**, nicht „in Ordnung“.\n\nVon ① kommend ist der Markenfilter gesetzt — leeren zeigt wieder alle.' }] },
      // Die Tabelle ueber die volle Breite. Zwanzig Spalten -- Betrieb,
      // Marke, Stadt und je Bereich Wert und Ampel -- passen auf fuenfzehn
      // Einheiten nicht; bis zum 28.07.2026 stand die Standortkarte
      // daneben, und man scrollte an sechs Ampeln vorbei. Bei einer
      // Tabelle, die Betriebe VERGLEICHBAR machen soll, ist das der
      // teuerste Platz im Layout.
      { teile: [
        { karte: 'dd_filialen_tabelle', hoehe: 12,
          klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
      // Die Standortkarte rueckt neben den Metrikvergleich: beide zeigen
      // die Verteilung ueber die gewaehlte Menge, nur einmal raeumlich und
      // einmal nach Bereich. Klick auf ein Segment fuehrt auf die Liste
      // darunter -- Bereich von der Achse, Bewertung aus der Farbe.
      { teile: [
        { karte: 'so_karte_klein', breite: 9, hoehe: 12,
          klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
        { karte: 'dd_filialen_metrikvergleich', breite: 15, hoehe: 12,
          klick: [{ ziel: 'dd_filialen', uebergabe: { bereich: 'Bereich', ampel: 'Ampelwert' } }] },
      ] },
      { teile: [
        { karte: 'dd_filialen_rangliste', hoehe: 11,
          klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
      { teile: [{ text: '## Betriebe hinter einem Balken\n\nEin Klick auf ein Balkensegment füllt diese Liste. Ohne Auswahl stehen alle Bereiche untereinander.' }] },
      { teile: [{ karte: 'dd_filialen_bereich', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Umsatz gegen Personalkosten\n\nRechts unten steht, was man sich wünscht: viel Umsatz bei niedriger Quote. Links oben die Betriebe, bei denen beides nicht stimmt.' }] },
      { teile: [{ karte: 'dd_filialen_streuung', hoehe: 10,
        klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'dd_betrieb',
    name: '③ Betrieb',
    beschreibung:
      'Alle Kennzahlen eines Betriebs an einer Stelle. Jede Kachel führt per Klick in die passende Detailauswertung. Oben den Betrieb auswählen oder von Ebene ② hierherkommen.',
    sammlung: 'Drill-Down',
    // Monat UND Zeitraum, und das ist kein Widerspruch, sondern der Grund,
    // warum die Strukturdiagramme lange gar nicht auf die Zeit hoerten.
    //
    // Der Monatsfilter waehlt einen STICHMONAT -- richtig fuer die sechs
    // Ampeln, die es je Monat einmal gibt. Ein Verlauf kann ihn nicht
    // lesen: bliebe ein Punkt uebrig, waere die Kurve weg. Genau deshalb
    // standen "wovon dieser Betrieb lebt", Zeitzonen und Tagesverlauf in
    // FILTER_AUSNAHME -- mit der Begruendung "ueber die gesamte Historie".
    //
    // Das war die falsche Antwort auf die richtige Beobachtung. Wer oben
    // einen Monat einstellt, erwartet nicht dreieinhalb Jahre darunter.
    // Gemeldet am 28.07.2026. Die Loesung ist nicht, dem Verlauf einen
    // Stichmonat aufzuzwingen, sondern der Seite einen ZEITRAUM zu geben,
    // den ein Verlauf lesen kann.
    filter: [F_MONAT, F_ZEITRAUM_DREI_MONATE, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# ③ Betrieb\n\nJedes Diagramm führt per Klick in die Detailauswertung.\n\n**Monat** gilt für die Ampeln und Kennzahlen, **Zeitraum** für die Verläufe darunter.' }] },
      // Die vier Kennzahlkacheln bleiben in einer eigenen Reihe: eine Reihe
      // ist so hoch wie ihr hoechstes Element, und neben der Karte waeren
      // die Zahlen auf zwoelf Einheiten auseinandergezogen.
      { teile: [
        { karte: 'dd_betrieb_umsatz_kachel' },
        { karte: 'dd_betrieb_ytd_kachel' },
        { karte: 'dd_betrieb_gaeste_kachel' },
        { karte: 'dd_betrieb_bon_kachel' },
      ] },
      { teile: [{ text: '## Die sechs Kennzahlen des Round Table\n\nJeweils mit Vormonat, Veränderung und Ampelwechsel.' }] },
      // Die Kennzahlentabelle ueber die volle Breite. Sie stand bis zum
      // 28.07.2026 auf sechzehn Einheiten mit der Standortkarte daneben --
      // und brauchte damit waagerechtes Scrollen, um von "Aktuell" bis
      // "Ursache" zu kommen. Wer scrollen muss, um die dritte Spalte zu
      // sehen, vergleicht sie nicht mehr mit der ersten; genau dafuer ist
      // eine Tabelle aber da.
      // Hoehe 9, nicht 12: bei gewaehltem Betrieb sind es genau sechs
      // Zeilen, und der Rest stand leer. Ohne Betriebsfilter scrollt die
      // Tabelle -- das ist der seltenere Fall und der richtige Ort dafuer.
      { teile: [{ karte: 'dd_betrieb_kopf', hoehe: 9 }] },
      // Die Standortkarte steht jetzt neben dem Ampelverlauf. Beide
      // beantworten dieselbe Frage -- wo steht dieses Haus, und wie steht
      // es da -- und beide brauchen keine waagerechte Ausdehnung.
      { teile: [
        { karte: 'dd_betrieb_ampelverlauf', breite: 16, hoehe: 12 },
        { karte: 'so_karte_klein', breite: 8, hoehe: 12 },
      ] },
      { teile: [
        { karte: 'dd_betrieb_verlauf',
          klick: [{ ziel: 'db_umsatz', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
      { teile: [{ text: '## Struktur — wovon dieser Betrieb lebt' }] },
      // Zwei Diagramme nebeneinander, der Tagesverlauf allein darunter.
      //
      // Zu dritt bekam jedes acht Rastereinheiten. Fuer "Speisen und
      // Getraenke" (zwei Kategorien) und die Zeitzonen (fuenf) reicht
      // das; der Tagesverlauf hat VIERUNDZWANZIG Balken und damit rund
      // 14 Pixel je Balken. Eine Beschriftung wie "08:00" braucht 40 --
      // Metabase liess deshalb ALLE Stunden weg, gemeldet am 28.07.2026.
      // Uebrig blieb der Achsentitel "Stunde" ueber unbeschrifteten
      // Balken, was schlimmer ist als gar keine Achse: man sieht ein
      // Muster und kann es keiner Tageszeit zuordnen.
      { teile: [
        { karte: 'dd_betrieb_sparte', klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },
        { karte: 'dd_betrieb_zeitzone', klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
      { teile: [
        { karte: 'dd_betrieb_stunde', klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
      { teile: [{ text: '## Personal, Ware, BWA' }] },
      { teile: [{ karte: 'dd_betrieb_personal',
        klick: [{ ziel: 'db_personal', uebergabe: { betrieb: 'Betrieb' } }] }] },
      // Artikeltabelle und BWA-Verlauf untereinander: sechs Spalten mit
      // Artikel- und Warengruppennamen passen auf eine halbe Breite nicht,
      // und der Artikelname steht ganz links.
      { teile: [{ karte: 'dd_betrieb_artikel', hoehe: 11,
        klick: [{ ziel: 'db_ware', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'dd_betrieb_bwa',
        klick: [{ ziel: 'db_bwa', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Maßnahmen und Datenstand' }] },
      { teile: [{ karte: 'dd_betrieb_massnahmen' }] },
      { teile: [{ karte: 'dd_betrieb_datenstand' }] },
    ],
  },

  {
    schluessel: 'vg_zeit',
    name: '④ Zeiträume vergleichen',
    beschreibung:
      'Zwei frei wählbare Zeiträume nebeneinander, je Betrieb und in Summe. Voreingestellt ist der laufende Monat bis heute gegen denselben Ausschnitt des Vormonats.',
    sammlung: 'Drill-Down',
    filter: [F_VON_A, F_BIS_A, F_VON_B, F_BIS_B, F_MARKE],
    reihen: [
      { teile: [{ text: '# ④ Zeiträume vergleichen\n\n**Zeitraum A** gegen **Zeitraum B**. Voreingestellt: laufender Monat gegen denselben Ausschnitt des Vormonats.\n\nUnterschiedlich lange Zeiträume sind erlaubt — die Differenz enthält sie dann mit.' }] },
      { teile: [{ karte: 'vg_zeit_summe' }] },
      { teile: [{ karte: 'vg_zeit_verlauf' }] },
      { teile: [{ text: '## Je Betrieb\n\nEin Klick auf den Betriebsnamen öffnet das Betriebsblatt.' }] },
      { teile: [{ karte: 'vg_zeit_betrieb', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'vg_ort',
    name: '⑤ Standorte vergleichen',
    beschreibung:
      'Mehrere Betriebe nebeneinander über alle Kennzahlen, im Umsatzverlauf, im Tagesverlauf und in der Aufteilung zwischen Speisen und Getränken. Oben die Betriebe auswählen.',
    sammlung: 'Drill-Down',
    // Der Monat gilt der Kennzahlentabelle, der Zeitraum dem Umsatzverlauf
    // und dem Tagesprofil darunter. Ohne ihn verglich das Tagesprofil
    // dreieinhalb Jahre, waehrend die Tabelle darueber einen Monat zeigte
    // -- zwei Aussagen ueber verschiedene Zeitraeume auf einer Seite.
    filter: [F_MONAT, F_ZEITRAUM_DREI_MONATE, F_BETRIEB, F_MARKE],
    reihen: [
      { teile: [{ text: '# ⑤ Standorte vergleichen\n\nOben Betrieb oder Marke auswählen. Ohne Auswahl stehen hier alle — für einen aussagekräftigen Vergleich zwei bis vier Betriebe wählen.\n\nDer Tagesverlauf zeigt **Prozent vom eigenen Tagesumsatz**. Sonst vergleicht man nur die Größe der Häuser und nicht ihr Muster.' }] },
      { teile: [{ karte: 'vg_ort_metriken', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'vg_ort_umsatz' }] },
      // Der Tagesverlauf allein auf voller Breite: vierundzwanzig Stunden
      // auf zwoelf Einheiten sind 22 Pixel je Balken, und eine
      // Beschriftung wie "08:00" braucht rund 40. Metabase laesst sie
      // dann samt und sonders weg -- man sieht ein Muster und kann es
      // keiner Tageszeit zuordnen.
      { teile: [{ karte: 'vg_ort_profil' }] },
      { teile: [{ karte: 'vg_ort_sparte', hoehe: 11 }] },
    ],
  },

  // ===================================================================
  // PORTFOLIO — die Fragen, die das Excel nicht stellte
  // ===================================================================
  {
    schluessel: 'pf_portfolio',
    name: '⑥ Portfolio und Potenzial',
    beschreibung:
      'Wo steckt der Umsatz, wie abhängig ist die Gruppe von wenigen Häusern, wie weit liegen vergleichbare Betriebe auseinander — und was wäre rechnerisch zu holen. Fragen, die man bei einer Handvoll Betriebe im Kopf beantwortet, bei über hundert nicht mehr.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_MARKE],
    reihen: [
      { teile: [{ text: '# ⑥ Portfolio und Potenzial\n\nDie Ampeln beantworten die Frage „wer ist rot". Diese Seite stellt die Fragen davor: Wo steckt der Umsatz, wovon hängt die Gruppe ab, wie weit liegen vergleichbare Häuser auseinander — und was kostet dieser Abstand.' }] },

      { teile: [{ text: '## Wo steckt der Umsatz\n\nEin Teil der geführten Betriebe macht gar keinen Umsatz. Das verzerrt jeden Anteil auf dieser Seite.' }] },
      { teile: [{ karte: 'pf_kachel_aktiv' }] },
      { teile: [{ karte: 'pf_konzentration_kurve', breite: 10 }] },
      { teile: [
        { karte: 'pf_konzentration', hoehe: 11,
          klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },

      { teile: [{ text: '## Was wäre zu holen\n\n„€ bis Median“ ist **kein Ziel**, sondern eine Größenordnung: was der Abstand zum Mittelfeld in Euro bedeutet.' }] },
      { teile: [{ karte: 'pf_potenzial', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pf_streuung' }] },

      { teile: [{ text: '## Betriebe ohne laufendes Geschäft\n\n> Betriebe ohne Umsatz verzerren **jeden** Durchschnitt — über 1000 % Personalkosten bei 0 € melden eine Katastrophe, wo kein Betrieb läuft. Vorlage zum Stilllegen.' }] },
      { teile: [{ karte: 'pf_karteileichen', klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'pf_muster',
    name: '⑦ Muster im Geschäft',
    beschreibung:
      'Wochenrhythmus, Planbarkeit und die Frage, ob eine Umsatzveränderung von der Gästezahl oder vom Bon kommt. Die Unterscheidung entscheidet darüber, welche Maßnahme überhaupt greift.',
    sammlung: 'Drill-Down',
    filter: [F_BETRIEB, F_MARKE],
    reihen: [
      { teile: [{ text: '# ⑦ Muster im Geschäft\n\nDrei Fragen, die darüber entscheiden, welche Maßnahme überhaupt greift.' }] },

      { teile: [{ text: '## Der Wochenrhythmus\n\nDas Verhältnis zwischen dem stärksten und dem schwächsten Wochentag ist der Ausgangspunkt jeder Diskussion über Öffnungszeiten, Dienstpläne und Ruhetage.' }] },
      { teile: [
        { karte: 'pf_wochentag' },
        { karte: 'pf_wochentag_marke' },
      ] },

      { teile: [{ text: '## Gäste oder Bon?\n\nEine Umsatzveränderung hat zwei mögliche Ursachen, und sie führen zu **verschiedenen Maßnahmen**: mehr oder weniger Gäste ist ein Marketing- und Standortthema, ein veränderter Bon ein Karten-, Preis- und Verkaufsthema.' }] },
      { teile: [{ karte: 'pf_gaeste_bon', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },

      { teile: [{ text: '## Wie planbar läuft ein Betrieb\n\nSchwankung im Verhältnis zum eigenen Durchschnitt — dadurch sind große und kleine Häuser vergleichbar. Hoher Wert = abhängig von Wochenenden und Wetter.' }] },
      { teile: [{ karte: 'pf_stabilitaet', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  // ===================================================================
  // ROUND TABLE — die Excel-Abloesung
  // ===================================================================
  {
    schluessel: 'db_round_table',
    name: '① Round Table',
    beschreibung:
      'Der Einstieg: oben die Zähler, darunter woran es liegt, dann die Betriebstabelle und die Marken. Ein Klick führt jeweils eine Ebene tiefer.',
    sammlung: 'Round Table',
    filter: [F_MONAT, F_MARKE],
    reihen: [
      { teile: [{ text: '# ① Round Table\n\n🟢 passt · 🟠 im Auge behalten · 🔴 sofort handeln · ⚪ nicht bewertbar (meist fehlt die BWA).\n\n**Round Table → Filiale → Betrieb.** Ein Klick führt eine Ebene tiefer, die Filter oben wandern mit.' }] },
      // Die Karte steht ganz oben: sie beantwortet keine Frage, sondern
      // gibt den Zahlen darunter einen Ort. Schraenkt man die Marke ein,
      // bleiben deren Haeuser stehen -- die raeumliche Einordnung passiert
      // dadurch im Vorbeigehen und kostet keinen Seitenwechsel.
      { teile: [{ karte: 'so_karte_klein', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      // Jede Zaehlkachel fuehrt auf die Liste der Betriebe, die sie zaehlt.
      // Der Wert wird fest mitgegeben -- "9 rote Betriebe" muss zu genau
      // diesen neun fuehren, nicht zu allen.
      { teile: [
        { karte: 'rt_kachel_rot',
          klick: [{ ziel: 'dd_filialen', uebergabe: { ampel: 'rot' }, fest: true }] },
        { karte: 'rt_kachel_orange',
          klick: [{ ziel: 'dd_filialen', uebergabe: { ampel: 'orange' }, fest: true }] },
        { karte: 'rt_kachel_gruen',
          klick: [{ ziel: 'dd_filialen', uebergabe: { ampel: 'gruen' }, fest: true }] },
        { karte: 'rt_kachel_ohne_urteil',
          klick: [{ ziel: 'dd_filialen', uebergabe: { ampel: 'ohne' }, fest: true }] },
        { karte: 'rt_kachel_massnahmen',
          klick: [{ ziel: 'db_rt_ursachen', uebergabe: {}, fest: true }] },
        { karte: 'rt_kachel_bewertung' },
      ] },
      { teile: [
        // "Personal / rot" ist eine Aussage ueber 19 Betriebe. Der Klick
        // fuehrt auf ② Filialen, wo die Liste dieser 19 steht -- nicht auf
        // dasselbe Diagramm in gross.
        { karte: 'rt_treiber', breite: 14,
          klick: [{ ziel: 'dd_filialen', uebergabe: { bereich: 'Bereich', ampel: 'Ampelwert' } }] },
        { karte: 'rt_intensitaet', breite: 10,
          klick: [{ ziel: 'dd_filialen', uebergabe: { intensitaet: 'Intensität' } }] },
      ] },
      { teile: [{ text: '## Die Betriebe\n\nSortiert nach Handlungsdruck: rot vor orange vor grün, innerhalb dessen nach Dringlichkeit.' }] },
      { teile: [{ karte: 'rt_tabelle', hoehe: 14,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      // ---------------------------------------------------------------
      // Die Markenebene. Sie stand bis zum 27.07.2026 auf einer eigenen
      // Seite "① Marken", was einen Umweg bedeutete: vom Round Table kam
      // man auf die Filialen, aber die Marke dazwischen fehlte.
      //
      // Jetzt ist der Round Table die Einstiegsebene, und die Marken
      // stehen hier -- zwischen der Betriebstabelle und dem Ausblick.
      // Sortiert wie der Rest der Seite: erst das Urteil, dann die
      // Kennzahlen, dann der Verlauf.
      // ---------------------------------------------------------------
      { teile: [{ text: '## Marken\n\nDie erste Frage vor jeder Maßnahme: schwächelt dieser eine Betrieb oder seine ganze Marke? Die Prozentwerte zeigen jeweils den mittleren Betrieb der Marke — ein Ausreißer verzieht so nicht das Bild.' }] },
      { teile: [{ karte: 'dd_marken_tabelle', hoehe: 11,
        klick: [{ ziel: 'dd_filialen', spalte: 'Marke', uebergabe: { marke: 'Marke' } }] }] },
      // Die Markentabelle stand bis zum 28.07.2026 auf zwoelf Einheiten
      // neben dem Ampeldiagramm. Elf Spalten, davon vier Medianwerte mit
      // langer Ueberschrift, gehen darauf nicht auf -- ueber die volle
      // Breite steht jede Marke in einer lesbaren Zeile.
      { teile: [
        { karte: 'dd_marken_ampeln',
          klick: [{ ziel: 'dd_filialen', uebergabe: { marke: 'Marke' } }] },
      ] },
      { teile: [
        { karte: 'rt_marke', hoehe: 10,
          klick: [{ ziel: 'dd_filialen', spalte: 'Marke', uebergabe: { marke: 'Marke' } }] },
      ] },
      { teile: [{ text: '### Marken nebeneinander\n\nJede Marke in jeder Kennzahl, mit dem Abstand zum Mittelfeld aller Betriebe. Zeigt, ob eine Marke durchgehend schwächer ist oder nur in einer Disziplin.' }] },
      { teile: [
        { karte: 'pf_marken_matrix', hoehe: 10,
          klick: [{ ziel: 'dd_filialen', spalte: 'Marke', uebergabe: { marke: 'Marke' } }] },
      ] },
      { teile: [
        { karte: 'pf_marken_umsatzanteil',
          klick: [{ ziel: 'dd_filialen', uebergabe: { marke: 'Marke' } }] },
      ] },
      { teile: [{ karte: 'dd_marken_verlauf' }] },
      { teile: [{ karte: 'rt_marke_abweichung', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_rt_trend',
    name: 'Round Table — Trend und Ampelhistorie',
    beschreibung:
      'Wie sich die Ampeln über die Monate entwickelt haben. Die Vormonate und die Historie stehen automatisch zur Verfügung.',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    reihen: [
      { teile: [{ text: '# Trend und Historie\n\nWie sich die Ampeln über die Monate entwickelt haben. Die Historie schreibt sich von selbst fort und muss nicht gepflegt werden.' }] },
      { teile: [
        // Ein Segment heisst "die roten Betriebe im Maerz". Beides wandert
        // mit: der Monat von der Achse, die Bewertung aus der Farbe.
        { karte: 'rt_historie',
          klick: [{ ziel: 'dd_filialen', uebergabe: { monat: 'Monat', ampel: 'Ampelwert' } }] },
        { karte: 'rt_historie_bereich' },
      ] },
      { teile: [{ text: '## Wer hat die Farbe gewechselt\n\nDie Liste, mit der ein Round Table anfangen sollte. Verschlechterungen zuerst.' }] },
      { teile: [{ karte: 'rt_ampelwechsel', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Die letzten drei Monate je Betrieb und Bereich\n\n↗ besser oder gleich, ↘ schlechter. Dabei gilt je Bereich die richtige Richtung: bei Personal- und Wareneinsatzquoten ist ein kleinerer Wert der bessere.' }] },
      { teile: [{ karte: 'rt_trend_tabelle', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_rt_ursachen',
    name: 'Round Table — Ursachen und Maßnahmen',
    beschreibung:
      'Ursachen hinter den Ampeln und die daraus abgeleiteten Maßnahmen. Beides wird von Hand erfasst — bleiben die Tabellen leer, heißt das „nichts eingetragen", nicht „keine Probleme".',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    reihen: [
      { teile: [{ text: '# Ursachen und Maßnahmen\n\n> **Diese Seite ist so gut wie ihre Pflege.** Ursachen und Maßnahmen kommen nicht aus LINA, sondern werden von Hand erfasst. Eine leere Tabelle heißt hier **„nichts eingetragen"**, nicht „keine Probleme".' }] },
      { teile: [{ karte: 'rt_ursachen', hoehe: 11 }] },
      { teile: [{ karte: 'rt_ursachen_verlauf' }] },
      { teile: [{ text: '## Maßnahmen' }] },
      { teile: [{ karte: 'rt_massnahmen_status', breite: 8 }] },
      // Dreizehn Spalten -- von "Verantwortlich" bis "Notizen" -- auf
      // sechzehn Einheiten hiessen scrollen, um zu sehen, wer bis wann
      // was tut. Genau das ist der Zweck der Tabelle, also volle Breite.
      { teile: [
        { karte: 'rt_massnahmen_offen', hoehe: 11,
          klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
    ],
  },

  {
    schluessel: 'db_rt_regelwerk',
    name: 'Round Table — Regelwerk-Vergleich',
    beschreibung:
      'Eine offene Grundsatzfrage: Der Round Table misst alle Betriebe an denselben Schwellen (28/32 %), LINA führt je Betrieb eigene. Hier stehen beide Urteile nebeneinander — aber nur für die Betriebe, bei denen sie zu unterschiedlichen Ergebnissen führen.',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    reihen: [
      { teile: [{ text: '# Welche Schwellen gelten?\n\nRound Table: **28 / 32 %** für alle. LINA: eigene Grenzen je Betrieb.\n\nUnten nur die Betriebe, bei denen das zu **unterschiedlichen Urteilen** führt.' }] },
      { teile: [{ karte: 'rt_regelwerk_vergleich', hoehe: 13, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  // ===================================================================
  // BETRIEB — die Fachberichte
  // ===================================================================
  {
    schluessel: 'db_umsatz',
    name: 'Umsatz — Entwicklung',
    beschreibung:
      'Umsatzentwicklung, Durchschnittsbon und Umsatz je Gast.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB, F_ZEITRAUM],
    reihen: [
      { teile: [{ text: '# Umsatz\n\nAlle Werte sind Nettowerte, also ohne Mehrwertsteuer. Durchschnittsbon und Umsatz je Gast werden unverändert aus LINA übernommen.' }] },
      { teile: [
        { karte: 'um_kachel_monat' },
        { karte: 'um_kachel_gaeste' },
        { karte: 'um_kachel_bon' },
      ] },
      { teile: [{ karte: 'um_verlauf_tag', hoehe: 9 }] },
      { teile: [{ text: '## Gegen Vorjahr\n\nEuro und Prozent stehen absichtlich in **zwei getrennten Diagrammen**: übereinandergelegt lassen sich die beiden Maßstäbe so wählen, dass ein Zusammenhang entsteht, den die Zahlen gar nicht hergeben.' }] },
      { teile: [
        { karte: 'um_verlauf_monat' },
        { karte: 'um_verlauf_delta' },
      ] },
      { teile: [
        { karte: 'um_bon_gast', breite: 14 },
        { karte: 'um_wochentag', breite: 10 },
      ] },
      { teile: [{ text: '## Rangliste\n\nDie letzten Zeilen sind die interessanten.' }] },
      { teile: [{ karte: 'um_rangliste', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_struktur',
    name: 'Umsatz — Struktur',
    beschreibung:
      'Woher der Umsatz kommt: nach Speisen und Getränken, nach Verkaufsstelle und nach Tageszeit.',
    sammlung: 'Betrieb',
    // Monat UND Zeitraum, und das ist kein Versehen: die beiden Tabellen
    // unten zeigen einen Stichmonat je Betrieb, die Diagramme darueber
    // einen Verlauf. Der Zeitraum grenzt ein, welche Tage einfliessen --
    // ein Quartal, ein Halbjahr, "letzte 3 Monate".
    filter: [F_MONAT, F_BETRIEB, F_ZEITRAUM],
    reihen: [
      { teile: [{ text: '# Struktur des Umsatzes\n\nBisher werden nur die Sparten **Speisen** und **Getränke** geliefert. Ihre Summe ist deshalb kleiner als der Gesamtumsatz — es fehlt nichts in der Rechnung, sondern in den gelieferten Daten.\n\nOhne Zeitraum zählt die gesamte Historie.' }] },
      { teile: [
        { karte: 'st_sparte', breite: 14 },
        { karte: 'st_verkaufsstelle', breite: 10 },
      ] },
      { teile: [{ karte: 'st_sparte_anteil', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Tageszeit\n\nDer Geschäftstag läuft von 08:00 bis 07:59 des Folgetags. Die Nachtstunden gehören deshalb ans **Ende** des Tages, nicht an den Anfang.' }] },
      // Der Stundenverlauf allein auf voller Breite -- vierundzwanzig
      // Balken auf vierzehn Einheiten liessen Metabase alle Uhrzeiten
      // weglassen. Die Zeitzonen (fuenf Kategorien) darunter.
      { teile: [
        { karte: 'st_stunde' },
      ] },
      { teile: [{ karte: 'st_zeitzone' }] },
      { teile: [{ karte: 'st_zeitzone_betrieb', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_personal',
    name: 'Personal — Kosten und Effektivität',
    beschreibung:
      'Personalkostenquoten und Umsatz je Personalstunde, gesamt und getrennt nach Service, Bar und Küche.',
    sammlung: 'Betrieb',
    // Wie auf ③ Betrieb: der Monat gilt dem Stichmonat-Vergleich, der
    // Zeitraum den Verlaeufen und den Zeitraumtabellen darunter. Ohne ihn
    // zeigten pe_verlauf, pe_bereich und pe_effektivitaet die gesamte
    // Historie, waehrend oben ein Monat eingestellt war.
    filter: [F_MONAT, F_ZEITRAUM_DREI_MONATE, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# Personal\n\n**Quote** = Personalkosten in % vom Umsatz (was es kostet). **Umsatz je Personalstunde** = in Euro (was es einbringt).\n\nIm LINA-Bericht heißen beide „Effektivität“ — deshalb stehen sie getrennt.' }] },
      { teile: [{ karte: 'pe_quote_betrieb', hoehe: 11, klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pe_quote_tabelle', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pe_verlauf' }] },
      { teile: [{ karte: 'pe_bereich', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pe_effektivitaet', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_ware',
    name: 'Warenwirtschaft — Artikel, Deckungsbeitrag, Preise',
    beschreibung:
      'Was gut und was kaum läuft, Deckungsbeitrag je Warengruppe, rechnerischer gegen tatsächlichen Wareneinsatz und die Entwicklung der Einkaufspreise.',
    sammlung: 'Betrieb',
    // Die Marke gehoert hierher, seit der Drill-Down vom Round Table
    // hierher fuehrt: wer aus "Enchilada" kommt, will die Verbraeuche von
    // Enchilada sehen und nicht die aller 141 Betriebe.
    filter: [F_BETRIEB, F_MARKE, F_ZEITRAUM_QUARTAL],
    reihen: [
      { teile: [{ text: '# Warenwirtschaft\n\n„Abdeckung“ ist der Anteil des Umsatzes, für den Rezepturen hinterlegt sind — bei niedriger Abdeckung sagt der Deckungsbeitrag wenig. Er liegt nur monatsweise vor.\n\nVoreingestellt sind die letzten drei Monate; ein größerer Zeitraum dauert entsprechend länger.' }] },
      // Untereinander statt nebeneinander: sieben Spalten mit Artikel- und
      // Warengruppennamen brauchen auf zwoelf Einheiten waagerechtes
      // Scrollen, und der Artikelname steht ganz links. Beide Listen
      // beantworten ohnehin nacheinander gestellte Fragen -- was laeuft,
      // und was nicht -- und nicht dieselbe im Vergleich.
      { teile: [{ karte: 'wa_renner', hoehe: 12 }] },
      { teile: [{ karte: 'wa_penner', hoehe: 12 }] },
      { teile: [{ karte: 'wa_db_warengruppe', hoehe: 11 }] },
      // Der Abschnitt "Rechnerischer Wareneinsatz gegen tatsächlichen"
      // ist am 01.08.2026 entfallen (Migration 0029). Er stand auf
      // mart.pruefung_wareneinsatz, und die rechnete auf fixer_we aus
      // LINAs Warenwirtschaft -- Demodaten. Schlimmer: die Karte wies
      // fuer knapp die Haelfte aller Betriebsmonate eine Luecke in
      // voller Hoehe des BWA-Wareneinsatzes aus und meldete daneben
      // "Abdeckung 100 %". Kommt in Stufe 2.4 auf FoodNotify-Basis
      // zurueck, siehe docs/plan-foodnotify.md.
      // Der Abschnitt "Einkaufspreise" ist am 01.08.2026 entfallen
      // (Migration 0030), weil er Demodaten als echte Einkaufspreise
      // zeigte. Seit dem 02.08.2026 steht er wieder -- aber als EIGENES
      // Dashboard "Einkauf" (db_einkauf, gleich unten), nicht hier.
      //
      // Warum getrennt: dieses Dashboard filtert ueber einen
      // Feldfilter auf mart.artikelverkauf.geschaeftstag. Die
      // Einkaufskarten stehen auf ganz anderen Sichten, kennen diese
      // Spalte nicht und wuerden den gemeinsamen Zeitraumfilter still
      // ignorieren -- ein gesetzter Filter, der nichts tut, ist
      // schlimmer als keiner (siehe docs/fehlerkatalog.md).
    ],
  },

  {
    schluessel: 'db_einkauf',
    name: 'Einkauf — Preise, Lieferanten, Volumen',
    beschreibung:
      'Was der Wareneinkauf tatsächlich gekostet hat: Preise je Ware im Zeitverlauf, was teurer geworden ist, und wie viel jeder Betrieb einkauft. Aus den echten Bestellungen bei FoodNotify — keine Katalogpreise.',
    sammlung: 'Betrieb',
    // Kein Zeitraumfilter: die Einkaufssichten aggregieren bereits auf
    // Monate, und ein Feldfilter braeuchte je Karte eine andere Tabelle.
    // Gefiltert wird ueber Marke und Betrieb. Die Marke ist hier der
    // FOODNOTIFY-MANDANT (vier Werte), nicht das Round-Table-Konzept —
    // acht der zwoelf Konzern-Marken lieferten grundsaetzlich leere
    // Karten, siehe F_MARKE_EINKAUF.
    filter: [F_BETRIEB, F_MARKE_EINKAUF],
    reihen: [
      { teile: [{ text: '# Einkauf\n\n**Die Daten werden noch geladen** — je Kostenstelle chronologisch aufsteigend: bei unfertigen Marken fehlen gerade die **jüngsten** Monate. Ein Monat mit wenigen Positionen ist meist noch nicht fertig, nicht etwa ein Einbruch. Die erste Karte sagt, welche Marken vollständig sind.\n\nAlle Preise sind **je Gebinde** — was ein bestellter Karton, Sack oder Eimer gekostet hat. Der Preis je Kilo oder Liter steht als Zusatzspalte daneben, bleibt aber oft leer: FoodNotify pflegt die Angabe, wie viel in einem Gebinde steckt, für dieselbe Ware widersprüchlich. Was auffällt oder fehlt, steht in der letzten Karte.' }] },
      // Der Ladestand steht GANZ OBEN, nicht unten als Fussnote: solange
      // der Backfill laeuft, ist er die Voraussetzung fuer jede Aussage
      // ueber einen Zeitraum.
      { teile: [{ karte: 'wa_ladestand', hoehe: 9 }] },
      { teile: [{ karte: 'wa_preis_veraenderung', hoehe: 12 }] },
      { teile: [{ karte: 'wa_preise', hoehe: 12 }] },
      // Die Lieferanten — der Titel der Seite versprach sie von Anfang
      // an, gezeigt hat sie bisher keine Karte.
      { teile: [{ text: '## Lieferanten\n\nJe **Marke**, nicht je Konzern: FoodNotify führt denselben Lieferanten je Mandant als eigenen Vertrag. Ein Anteil über 60 % beim größten Lieferanten heißt: dieses Haus hat faktisch einen Monopol-Lieferanten.' }] },
      { teile: [{ karte: 'wa_lieferant_volumen', hoehe: 11 }] },
      { teile: [{ karte: 'wa_lieferant_konzentration', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'wa_einkauf_betrieb', hoehe: 11 }] },
      // Die Pruefliste ganz unten, aber sichtbar: eine ausgeschlossene
      // Position, die nirgends auftaucht, ist eine stille Kuerzung.
      { teile: [{ karte: 'wa_einkauf_pruefung', hoehe: 10 }] },
    ],
  },

  {
    schluessel: 'db_bwa',
    name: 'BWA — Kennzahlen und Buchungsstand',
    beschreibung:
      'Umsatz, Wareneinsatz, Personalkosten und Ergebnis aus den Zahlen des Steuerberaters — und bis wann diese Zahlen überhaupt vorliegen.',
    sammlung: 'Betrieb',
    // Ohne Vorgabe: die BWA reicht nur so weit, wie der Steuerberater
    // gebucht hat, und das sind je nach Betrieb ein bis vier Monate
    // zurueck. Drei Monate als Vorgabe wuerden bei manchen Betrieben eine
    // leere Kurve zeigen -- und "nicht gebucht" liest sich als "kein
    // Umsatz". Wer eingrenzen will, stellt den Filter selbst.
    filter: [F_MONAT, F_ZEITRAUM, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# Betriebswirtschaftliche Auswertung (BWA)\n\n> Zahlen vom Steuerberater, üblicherweise **ein bis zwei Monate zurück**. Ein Monat auf null ist **nicht gebucht** — nicht umsatzlos. Gezeigt werden nur gebuchte Monate.' }] },
      { teile: [{ karte: 'bwa_kennzahlen', hoehe: 9 }] },
      { teile: [{ karte: 'bwa_ebit', hoehe: 11, klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Buchungsstand\n\nZwei Monate Verzug sind normal, vier eine Nachfrage beim Steuerberater wert.' }] },
      { teile: [{ karte: 'bwa_buchungsstand', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_datenqualitaet',
    name: 'Datenqualität und Import',
    beschreibung:
      'Kommen die Daten an, stimmen die Zahlen, und für welche Betriebe reicht die Datenlage für ein Urteil? Die Seite, die man aufschlägt, bevor man den anderen glaubt.',
    sammlung: 'Betrieb',
    reihen: [
      { teile: [{ text: '# Datenqualität\n\nEin Betrieb ohne Daten sieht auf allen anderen Seiten aus wie einer, bei dem alles stimmt. Hier steht, bei wem das der Fall ist.' }] },
      { teile: [{ karte: 'dq_befund', breite: 10 }] },
      // Volle Breite: siebzehn Endpunktnamen auf vierzehn Einheiten sind
      // 36 Pixel je Balken, und ein Name wie "getPersonalkosten" braucht
      // mehr. Metabase laesst die Beschriftung dann weg.
      { teile: [{ karte: 'dq_backfill_balken' }] },
      { teile: [{ text: '## Kommen die Daten an?' }] },
      { teile: [{ karte: 'dq_backfill', hoehe: 11 }] },
      { teile: [{ karte: 'dq_sync' }] },
      { teile: [{ text: '## Stimmen die Zahlen?\n\n„Auffällig" ist eine **Arbeitsliste, kein Alarm**. Beim Wareneinsatz zählt die Spalte die Fälle, in denen zu wenige Rezepturen hinterlegt sind — nicht die inhaltlichen Abweichungen.' }] },
      { teile: [{ karte: 'dq_pruefung', hoehe: 9 }] },
      { teile: [
        { karte: 'dq_umsatz_abweichung', hoehe: 11,
          klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
      { teile: [{ text: '## Wem fehlt was?\n\nDie folgenden Tabellen sind Arbeitslisten. **Die Liste der Betriebe ohne Zuordnung zum Steuerberater sollte leer sein.**' }] },
      { teile: [{ karte: 'dq_datenstand', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'dq_ohne_bruecke' }] },
      // Volle Breite: die Spalte mit den Beispielnamen ist der Zweck der
      // Karte, und auf zwoelf Einheiten sah man davon drei Namen.
      { teile: [{ karte: 'dq_konzept' }] },
    ],
  },

  // ===================================================================
  // Die technische Seite. Bewusst in eigener Sammlung: sie beantwortet
  // keine fachliche Frage, sondern die davor -- laeuft der Import, und
  // wenn nicht, woran liegt es.
  //
  // Reihenfolge ist die Reihenfolge des Nachfragens:
  //   laeuft es? -> woran haengt es? -> was macht er? -> wie weit ist er?
  // ===================================================================
  {
    schluessel: 'db_import',
    name: 'Import — Überwachung',
    beschreibung:
      'Läuft der Datenimport, wie weit ist er, was macht er als Nächstes — und wenn etwas scheitert, woran es liegt. Die technische Seite; für die fachliche Sicht auf Lücken siehe „Datenqualität".',
    sammlung: 'Technik',
    reihen: [
      { teile: [{ text: '# Import — Überwachung\n\n> **„keine Daten“ ist kein Fehler** — LINA meldet das, wenn ein Betrieb einen Bericht nicht führt. Nur was unter „Fehler“ steht, ist einer.' }] },
      { teile: [
        { karte: 'im_ampel' },
        { karte: 'im_prozent' },
        { karte: 'im_tempo' },
        { karte: 'im_restzeit' },
      ] },
      { teile: [{ karte: 'im_kopf' }] },

      { teile: [{ text: '## Woran hängt es?\n\n**Ruht der Zugang, steht alles still** — dann erübrigt sich die weitere Suche. Sperren laufen von selbst ab; nur ein Anmeldefehler braucht einen Menschen.' }] },
      { teile: [{ karte: 'im_sperre' }] },
      { teile: [{ karte: 'im_fehler', hoehe: 9 }] },
      { teile: [{ karte: 'im_schema' }] },
      { teile: [{ karte: 'im_laeufe', hoehe: 11 }] },

      { teile: [{ text: '## Was läuft gerade?\n\nDer Puls zeigt, ob überhaupt etwas passiert. Eine Lücke ist eine Pause — Sperre, Tagesbudget oder kein laufender Prozess.' }] },
      // Beide Stundenachsen untereinander statt nebeneinander: neunzehn
      // Stunden auf zehn Einheiten sind 23 Pixel je Balken, zu wenig fuer
      // eine Uhrzeit. Metabase laesst die Beschriftung dann ganz weg.
      { teile: [{ karte: 'im_puls' }] },
      { teile: [{ karte: 'im_wartezeit' }] },
      { teile: [{ karte: 'im_naechste', hoehe: 12 }] },

      { teile: [{ text: '## Wie vollständig ist es?\n\n**„Tage alt“** zeigt einen hängenden Bericht — ein bis zwei Tage sind normal. **„wartet“** heißt nicht kaputt: laufender Betrieb geht vor Historie.' }] },
      { teile: [{ karte: 'im_bericht', hoehe: 11 }] },
      { teile: [
        { karte: 'im_bericht_balken', breite: 12 },
        { karte: 'im_reichweite', breite: 12 },
      ] },
      { teile: [{ karte: 'im_betrieb', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  // ===================================================================
  // Die Karte. Eigene Seite statt Kachel auf "① Marken": eine Karte
  // braucht Hoehe, und darunter gehoert die Liste, die sagt, wer FEHLT --
  // sonst haelt man 45 Punkte fuer alle 141 Betriebe.
  // ===================================================================
  {
    schluessel: 'so_karte_db',
    name: '⑧ Standortkarte',
    beschreibung:
      'Alle Standorte mit hinterlegten Koordinaten auf einer Karte, eingefärbt nach der Gesamtampel des gewählten Monats. Ein Klick auf einen Punkt öffnet die Detailseite des Betriebs.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_MARKE],
    reihen: [
      { teile: [{ text: '# ⑧ Standortkarte\n\n🟥 eskalieren · 🔴 handeln · 🟠 nachforschen · 🟢 ok · ⚪ keine Bewertung. Klick öffnet den Betrieb, Antippen zeigt die sechs Einzelampeln.\n\nNur Standorte mit hinterlegter Adresse — die fehlenden stehen unten.' }] },
      { teile: [
        { karte: 'so_karte', breite: 15, hoehe: 16,
          klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
        // Der Balken zaehlt nur ROTE, deshalb genuegt der Bereich aus der
        // Achse -- die Bewertung ist bei dieser Karte immer dieselbe und
        // wird auf der Zielseite von Hand gesetzt, falls noetig.
        { karte: 'so_rot_treiber', breite: 9, hoehe: 16,
          klick: [{ ziel: 'dd_filialen', uebergabe: { bereich: 'Bereich', ampel: 'Ampelwert' } }] },
      ] },
      { teile: [{ text: '## Wie sich die Standorte verteilen' }] },
      { teile: [{ karte: 'so_verteilung', hoehe: 9, klick: [{ ziel: 'dd_filialen', uebergabe: { marke: 'Marke' } }] }] },
      { teile: [{ text: '## Dieselben Standorte als Liste\n\nSortiert nach Handlungsdruck. Die Spalte „Genauigkeit" sagt, wie genau der Punkt sitzt — „adresse" ist hausgenau, „ort" nur stadtgenau.' }] },
      { teile: [{ karte: 'so_tabelle', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Wer fehlt auf der Karte\n\nFür diese Betriebe ist keine Adresse hinterlegt. **Die mit Umsatz stehen oben** — bei denen lohnt das Nachtragen zuerst.' }] },
      { teile: [{ karte: 'so_fehlend', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },
]
