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
// Die einzelne Zaehlung. OHNE Werteliste: der Filter wird geklickt, nicht
// von Hand gesetzt -- eine Auswahlliste mit 355 Schluesselzahlen waere
// niemandem eine Hilfe. Wer die Seite ohne Wert oeffnet, sieht die
// letzten Zaehlungen.
const F_INVENTUR: Parameter = {
  id: 'd-inventur', name: 'inventur', 'display-name': 'Zählung', type: 'string/=',
}
// Der einzelne Beleg -- ebenfalls ohne Werteliste: 50.072 Schluesselzahlen
// waeren keine Auswahl, sondern eine Zumutung. Angesteuert wird geklickt.
const F_BESTELLUNG: Parameter = {
  id: 'd-bestellung', name: 'bestellung', 'display-name': 'Beleg', type: 'string/=',
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
/**
 * Die Note einer einzelnen Bewertung. Ersetzt die frueheren zwei Karten
 * "beste" und "schlechteste": wer die Kritik sehen will, stellt 1 oder 2
 * ein, statt eine zweite Tabelle mit umgedrehtem ORDER BY zu lesen.
 */
const F_NOTE: Parameter = {
  id: 'd-note', name: 'note', 'display-name': 'Sterne', type: 'text',
  festeWerte: ['1', '2', '3', '4', '5'],
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

/**
 * Zeitraum fuer die Umsatzentwicklung — zwoelf Monate als Vorgabe.
 *
 * Ohne Vorgabe zeichnete um_verlauf_tag beim Oeffnen 3.136 Tagespunkte
 * seit 2018 in eine Kachel. Zwoelf Monate, nicht drei: die Seite fragt
 * nach ENTWICKLUNG, und dafuer braucht es mindestens einen Jahreszyklus —
 * sonst sieht jede Saisonkurve wie ein Trend aus. Eine VORGABE, keine
 * Grenze.
 */
const F_ZEITRAUM_JAHR: Parameter = {
  id: 'd-zeitraum', name: 'zeitraum', 'display-name': 'Zeitraum', type: 'date/all-options',
  default: 'past12months',
}

/**
 * Der Markenfilter des EINKAUFS — gleicher Slug, andere Grundgesamtheit.
 *
 * Die Einkaufssichten fuehren die FoodNotify-Mandanten (vier Marken),
 * nicht die zwoelf Round-Table-Hauptkonzepte. Acht der zwoelf lieferten
 * grundsaetzlich leere Karten, und sechs Betriebe waren nur unter der
 * falschen Marke auffindbar. Die Liste kommt deshalb aus
 * mart.einkauf_ladestand; src/sync/auswahllisten.ts kennt dieselbe
 * Ausnahme (LISTEN_JE_DASHBOARD), damit der Nachlauf sie nicht
 * ueberschreibt.
 */
const F_MARKE_EINKAUF: Parameter = {
  id: 'd-marke', name: 'marke', 'display-name': 'Marke', type: 'string/=',
  werteliste: ['mart', 'einkauf_ladestand', 'marke'],
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
      // EINE sortierbare Liste, nicht zwei nebeneinander. Die erste
      // Fassung hatte "beste" und "schlechteste" als getrennte Karten;
      // verworfen am 03.08.2026, weil beide aus demselben Topf schoepfen
      // und sich nur in der Sortierrichtung unterscheiden. Metabase
      // sortiert eine Tabelle auf Klick — die zweite Karte war nur eine
      // vorweggenommene Kopfbewegung.
      { teile: [{ text: '## Online-Bewertungen\n\nSchlechteste zuerst — auf jede Spaltenüberschrift klicken dreht die Reihenfolge. Der **Stand** ist der Schnitt über alle Bewertungen, das was ein Gast auf Google sieht; **Ø neu** sind die des laufenden Monats.' }] },
      { teile: [{ karte: 'bw_rangliste', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      // Das Themenprofil direkt unter der Bewertungs-Rangliste: die
      // Rangliste sortiert die Haeuser, diese Tabelle sagt zu jedem, WOBEI
      // es haengt. Beide lesen denselben Monat und dieselbe Marke, also
      // stehen sie untereinander und nicht auf getrennten Seiten.
      { teile: [{ text: '### Woran es bei wem liegt\n\nDie Note je Thema, schwächstes Haus zuerst. **Schwachpunkt** ist das Thema mit dem größten Abstand nach unten zum eigenen Schnitt des Hauses. Erst ab April 2026 — Yext klassifiziert nicht rückwirkend.' }] },
      { teile: [{ karte: 'yx_themen_betrieb', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
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
    filter: [F_MONAT, F_ZEITRAUM_DREI_MONATE, F_BETRIEB, F_NOTE],
    // REITER statt einer Rollbahn: die Seite hatte zwanzig Reihen
    // untereinander, und wer die BWA suchte, scrollte an den Bewertungen
    // vorbei. Die Filter oben gelten fuer alle Reiter; Drill-Downs von
    // aussen landen auf "Ueberblick" — dort steht, was der Klick meinte.
    tabs: [
      { name: 'Überblick', reihen: [
      { teile: [{ text: '# ③ Betrieb\n\nJedes Diagramm führt per Klick in die Detailauswertung, die Reiter oben gliedern die Seite.\n\n**Monat** gilt für die Ampeln und Kennzahlen, **Zeitraum** für die Verläufe.' }] },
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
      // ZWEI MASSSTAEBE DIREKT UNTER DEN KENNZAHLEN (angefragt 10.08.2026).
      //
      // Die Tabelle darueber beantwortet "wie hat es sich entwickelt"
      // (Vormonat, Trend, Ampelwechsel), diese "wie steht es gegen die
      // anderen". Dieselbe Zeilenreihenfolge, damit man von oben nach
      // unten lesen kann, ohne die Kennzahl zu suchen.
      //
      // Bewusst NICHT in dd_betrieb_kopf hineingezogen: die Karte hat
      // schon neun Spalten, vier weitere ergaeben dreizehn und damit
      // waagerechtes Scrollen -- derselbe Fehler, der am 28.07.2026 zur
      // vollen Breite gefuehrt hat.
      { teile: [{ text: '## Liegt es an diesem Haus?\n\nDieselben Kennzahlen gegen zwei Maßstäbe: die **eigene Marke** (gleiches Konzept, ganz Deutschland — fängt ab, was am Konzept liegt) und die **eigene Stadt** (gleiches Wetter, gleiche Feiertage, andere Konzepte — fängt ab, was am Standort liegt).\n\n**Der Rang ist die Aussage**, nicht der Abstand: „16 von 17" ist eindeutig, „+5,8" nicht — bei Personal und Wareneinsatz ist weniger besser.\n\nDie vier Vergleichsspalten sind **anklickbar**: die beiden Marken-Spalten öffnen alle Häuser der Marke, die beiden Stadt-Spalten alle Häuser am Ort — jeweils mit Betrieb und Monat von hier.' }] },
      // VIER klickbare Spalten, nicht zwei: die ganze Marken-Haelfte der
      // Zeile fuehrt zu ⑨, die ganze Stadt-Haelfte zu ⑩. Wer eine rote
      // Zahl sieht, greift nach IHR -- meist nach dem Rang, denn der
      // traegt die Aussage -- und nicht nach der Spalte daneben, die
      // zufaellig verlinkt ist. Zwei Klickflaechen je Thema statt einer.
      //
      // Die uebrigen Spalten (Kennzahl, ●, Wert) bleiben stumm, und das
      // ist Absicht: sie beschreiben das HAUS, nicht eine Vergleichs-
      // gruppe, und haetten deshalb kein eindeutiges Ziel. Ein Klick, der
      // raet, ist schlechter als keiner.
      //
      // Der Monat wandert von selbst mit (beide Ziele kennen den Filter
      // unter demselben Namen); der Betrieb kommt aus der Zeile.
      { teile: [{ karte: 'dd_betrieb_vergleich', hoehe: 9,
        klick: [
          { ziel: 'vg_marke', spalte: 'Marke (Median)', uebergabe: { betrieb: 'Betrieb' } },
          { ziel: 'vg_marke', spalte: 'Rang Marke',     uebergabe: { betrieb: 'Betrieb' } },
          { ziel: 'vg_stadt', spalte: 'Stadt (Median)', uebergabe: { betrieb: 'Betrieb' } },
          { ziel: 'vg_stadt', spalte: 'Rang Stadt',     uebergabe: { betrieb: 'Betrieb' } },
        ] }] },
      { teile: [{ karte: 'dd_betrieb_vergleich_verlauf' }] },
      // Die Standortkarte steht jetzt neben dem Ampelverlauf. Beide
      // beantworten dieselbe Frage -- wo steht dieses Haus, und wie steht
      // es da -- und beide brauchen keine waagerechte Ausdehnung.
      { teile: [
        { karte: 'dd_betrieb_ampelverlauf', breite: 16, hoehe: 12 },
        { karte: 'so_karte_klein', breite: 8, hoehe: 12 },
      ] },
      { teile: [
        // Leere uebergabe mit Absicht: diese Karten geben KEINE Spalte
        // "Betrieb" aus (der Betrieb ist hier schon der Dashboard-Filter).
        // Eine Spalten-Uebergabe auf eine fehlende Spalte speichert
        // Metabase klaglos und uebergibt dann NICHTS -- der Klick landete
        // auf dem Fach-Dashboard mit leerem Betriebsfilter, gemeldet am
        // 04.08.2026. Ohne eigene Belegung reicht uebernehmen.ts den
        // gleichnamigen Dashboard-Filter durch, und genau der ist gemeint.
        { karte: 'dd_betrieb_verlauf',
          klick: [{ ziel: 'db_umsatz', uebergabe: {} }] },
      ] },
      ] },
      { name: 'Gäste & Bewertungen', reihen: [
      // Die Gaeste-Sicht. Zwei Linien, die man nicht verwechseln darf:
      // der Stand traegt alle Bewertungen und bewegt sich kaum, der
      // Monatswert schwankt und laeuft ihm voraus. Genau deshalb stehen
      // sie in EINEM Diagramm -- getrennt saehe der Monatswert nach einem
      // instabilen Betrieb aus, statt nach einer Fruehwarnung.
      { teile: [{ text: '## Was Gäste sagen\n\n**Stand** = Schnitt über alle Bewertungen, das was auf Google steht und woran die Ampel hängt. Er bewegt sich träge, weil tausende Stimmen darin stecken.\n\n**Tendenz** = gleitender Schnitt der neuen Bewertungen über sechs Monate. Sie läuft dem Stand voraus: fällt sie darunter, sinkt der Stand irgendwann nach. Die Balken zählen die neuen Bewertungen — eine Tendenz aus drei Stimmen ist keine.' }] },
      { teile: [{ karte: 'bw_verlauf', hoehe: 9 }] },
      // Die Themen ZWISCHEN Kurve und Wortlaut, und zwar genau hier: die
      // Kurve sagt, dass es kippt, der Wortlaut sagt es in Saetzen, und
      // dazwischen fehlte bisher die Zwischenstufe -- welches Thema es
      // ist. Wer sie hat, muss nicht mehr vierzig Rueckmeldungen lesen,
      // um zu merken, dass es an der Wartezeit liegt.
      { teile: [{ text: '### Woran es liegt\n\nYexts Klusterung der Bewertungstexte dieses Betriebs. Die Note ist die der Bewertungen, die das Thema ansprechen; eine Bewertung kann mehrere Themen tragen. Erst ab April 2026 verfügbar.' }] },
      { teile: [
        { karte: 'yx_themen', breite: 11, hoehe: 9 },
        { karte: 'yx_themen_verlauf', breite: 13, hoehe: 9 },
      ] },
      { teile: [{ text: '### Antwortverhalten\n\nWie dieses Haus auf seine Bewertungen reagiert — Quote, Reaktionszeit und was offen liegt.' }] },
      { teile: [{ karte: 'yx_antwort_rangliste', hoehe: 9 }] },
      // Der Wortlaut direkt unter der Kurve. Die Kurve sagt, DASS es
      // kippt; diese beiden sagen, woran es liegt -- und das ist der
      // ganze Grund, warum die Einzelbewertungen ueberhaupt geladen
      // werden (migrations/0037_bewertung_einzeln.sql).
      { teile: [{ text: '### Im Wortlaut\n\nAlle Rückmeldungen mit Text, neueste zuerst. Über **Sterne** im Kopf auf eine Note eingrenzen — 1 und 2 sind die Liste, mit der man arbeitet. Jede Spaltenüberschrift sortiert. **Quelle** führt zum Original beim Portal.' }] },
      // EINE Liste, volle Breite, neueste zuerst. Zwei Karten (beste /
      // schlechteste) standen hier bis zum 03.08.2026 und sind
      // verworfen: sie schoepfen aus demselben Topf und unterscheiden
      // sich nur in der Sortierrichtung, die Metabase auf Klick ohnehin
      // liefert. Was fehlte, war ein Filter fuer die Note -- der steht
      // jetzt oben im Dashboardkopf.
      //
      // Volle Breite, weil hier gelesen wird: auf zwoelf Einheiten
      // bleiben dem Text 240 Pixel, und Metabase schneidet dann mitten
      // im Satz ab. Ein halber Satz ist kein halbes Argument, sondern
      // keins.
      { teile: [{ karte: 'bw_einzel', hoehe: 14 }] },
      ] },
      { name: 'Struktur', reihen: [
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
        { karte: 'dd_betrieb_sparte', klick: [{ ziel: 'db_struktur', uebergabe: {} }] },
        { karte: 'dd_betrieb_zeitzone', klick: [{ ziel: 'db_struktur', uebergabe: {} }] },
      ] },
      { teile: [
        { karte: 'dd_betrieb_stunde', klick: [{ ziel: 'db_struktur', uebergabe: {} }] },
      ] },
      ] },
      { name: 'Personal · Ware · BWA', reihen: [
      { teile: [{ text: '## Personal, Ware, BWA' }] },
      { teile: [{ karte: 'dd_betrieb_personal',
        klick: [{ ziel: 'db_personal', uebergabe: { betrieb: 'Betrieb' } }] }] },
      // Artikeltabelle und BWA-Verlauf untereinander: sechs Spalten mit
      // Artikel- und Warengruppennamen passen auf eine halbe Breite nicht,
      // und der Artikelname steht ganz links.
      { teile: [{ karte: 'dd_betrieb_artikel', hoehe: 11,
        klick: [{ ziel: 'db_ware', uebergabe: {} }] }] },
      { teile: [{ karte: 'dd_betrieb_bwa',
        klick: [{ ziel: 'db_bwa', uebergabe: {} }] }] },
      ] },
      // EIGENER REITER statt Anhaengsel an "Personal · Ware · BWA": die
      // Karten dort sind verdichtete Kennzahlen (Quoten, Rangfolgen,
      // Zeitreihen); Belegliste und Inventurliste sind Rohlisten wie
      // "Maßnahmen & Datenstand" nebenan -- selbe Kategorie, eigenes
      // Fachthema. Ein Anhaengsel haette die Ware-Reihe auf sechs Karten
      // gestreckt und die beiden neuen Listen unter dem Artikelverkauf
      // begraben, obwohl "Bestellungen" und "Ware" fachlich verschiedene
      // Fragen sind (was wurde verkauft, gegen was wurde eingekauft).
      { name: 'Einkauf & Inventur', reihen: [
      { teile: [{ text: '## Einkauf und Inventur\n\nBelege und Zählungen dieses Betriebs. Storno- und Signierkennzeichen stehen jeweils in einer eigenen Spalte, nicht als stille Kürzung.' }] },
      // Klick auf "ansehen →" oeffnet den Beleg; die uebrigen Spalten
      // bleiben unangetastet, damit ein Klick auf eine Zahl nicht
      // wegnavigiert -- dieselbe Regel wie bei der Inventurliste darunter.
      { teile: [{ karte: 'dd_betrieb_bestellungen', hoehe: 11,
        klick: [{ ziel: 'dd_beleg', spalte: 'Beleg',
                  uebergabe: { bestellung: 'bestellung_key' } }] }] },
      // Klick auf "ansehen →" oeffnet die Zaehlung; die uebrigen Spalten
      // bleiben unangetastet, damit ein Klick auf eine Zahl nicht
      // wegnavigiert. Der Schluessel kommt aus der ausgeblendeten Spalte
      // inventur_key -- Metabase reicht auch verborgene Spalten weiter.
      { teile: [{ karte: 'dd_betrieb_inventur', hoehe: 11,
        klick: [{ ziel: 'dd_inventur', spalte: 'Zählung',
                  uebergabe: { inventur: 'inventur_key' } }] }] },
      // Der Fremdeinkauf dieses Hauses. Nur die Kachel, nicht die ganze
      // Auswertung: das Betriebsblatt soll die Frage STELLEN, beantwortet
      // wird sie auf der eigenen Seite. Der Betriebsfilter wandert beim
      // Klick mit, weil beide Seiten ihn unter demselben Namen kennen.
      { teile: [{ karte: 'fe_kachel_verweis', breite: 8,
        klick: [{ ziel: 'db_fremdeinkauf', uebergabe: {}, fest: true }] }] },
      ] },
      { name: 'Maßnahmen & Datenstand', reihen: [
      { teile: [{ text: '## Maßnahmen und Datenstand' }] },
      { teile: [{ karte: 'dd_betrieb_massnahmen' }] },
      { teile: [{ karte: 'dd_betrieb_datenstand' }] },
      ] },
    ],
  },

  // Der einzelne Beleg. Eigenes Dashboard aus demselben Grund wie die
  // Zaehlung darunter: es beantwortet eine Frage zu EINEM Vorgang.
  {
    schluessel: 'dd_beleg',
    name: 'Beleg — was bestellt wurde',
    beschreibung:
      'Ein einzelner Bestellbeleg im Detail: jede bestellte Ware mit Menge, Gebinde, Einzelpreis und Summe. Erreichbar über „ansehen →" in der Bestellliste auf dem Betriebsblatt.',
    sammlung: 'Drill-Down',
    filter: [F_BESTELLUNG],
    reihen: [
      { teile: [{ text: '# Der einzelne Beleg\n\nWas in diesem Karton war — nach Positionswert sortiert, der teuerste Posten zuerst.\n\n**Gebinde** ist die Verpackungseinheit: bestellt wird in Kartons oder Kisten, der Einzelpreis gilt je Gebinde.\n\nEin **⚠** in „Preis" heißt, der berechnete Preis weicht vom hinterlegten ab. **„nicht angekommen"** heißt, die Position ist nicht eingetroffen — bei einer noch offenen Bestellung (Status „pending") steht das auf allen Zeilen und heißt schlicht „noch nicht geliefert".' }] },
      { teile: [{ karte: 'dd_beleg_kopf', hoehe: 9 }] },
      { teile: [{ karte: 'dd_beleg_positionen', hoehe: 16 }] },
    ],
  },

  // Die einzelne Zaehlung. Eigenes Dashboard und kein Reiter auf ③:
  // es beantwortet eine Frage zu EINEM Vorgang, nicht zu einem Betrieb --
  // dieselbe Stellung wie ③ zu ②. Ohne gewaehlte Inventur zeigt es die
  // letzten Zaehlungen, damit die Seite auch direkt aufgerufen etwas sagt.
  {
    schluessel: 'dd_inventur',
    name: 'Zählung — was gezählt wurde',
    beschreibung:
      'Eine einzelne Inventur im Detail: jede gezählte Ware mit Soll- und Ist-Menge, Preis und Differenz. Erreichbar über „ansehen →" in der Inventurliste auf dem Betriebsblatt.',
    sammlung: 'Drill-Down',
    filter: [F_INVENTUR],
    reihen: [
      { teile: [{ text: '# Die einzelne Zählung\n\n**Differenz = Soll minus Gezählt.** Positiv heißt, es fehlt etwas; negativ heißt, es ist mehr da als gebucht — meist ein Buchungsfehler.\n\nDie Liste steht nach dem **Geldwert der Differenz** sortiert: oben die Position, die den Schwund trägt. Zeilen mit **⚠** tragen einen Wert, den ein Warenbestand nicht haben kann; sie bleiben sichtbar, zählen aber in keiner Summe mit.' }] },
      { teile: [{ karte: 'dd_inventur_kopf', hoehe: 9 }] },
      { teile: [{ karte: 'dd_inventur_positionen', hoehe: 16 }] },
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
      { teile: [{ text: '# ④ Zeiträume vergleichen\n\n**Zeitraum A** gegen **Zeitraum B**. Voreingestellt: die letzten sieben abgeschlossenen Tage gegen dasselbe Fenster **vier Wochen früher** — Montag gegen Montag, sonst vergleicht man nur den Wochentagsmix.\n\nDie jüngsten Tage liefert LINA nach; fehlt in „Tage mit Daten" etwas, ist Zeitraum A noch unvollständig. Unterschiedlich lange Zeiträume sind erlaubt — die Differenz enthält sie dann mit.' }] },
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
  // VERGLEICHSGRUPPEN — der Massstab, gegen den ein Betrieb gelesen wird
  //
  // Gefragt am 10.08.2026: "ob bei allen der Umsatz eingebrochen ist oder
  // nur bei einem". Ein Rueckgang von zwoelf Prozent heisst etwas
  // voellig anderes, je nachdem ob die Nachbarhaeuser dasselbe zeigen
  // oder ob das Haus allein dasteht.
  //
  // Zwei Seiten statt einer mit Umschalter, weil sie verschiedene
  // Stoerquellen abfangen: die Marke, was am Konzept liegt (gleiche
  // Karte, gleiche Preise, ganz Deutschland); die Stadt, was am Standort
  // liegt (gleiches Wetter, gleiche Feiertage, gleiche Kaufkraft,
  // verschiedene Konzepte). Erst beide nebeneinander erlauben die dritte
  // Aussage -- faellt ein Haus gegen BEIDE ab, liegt es am Haus.
  //
  // KEIN zweiter Filter fuer Marke oder Stadt. Die Vergleichsgruppe wird
  // aus dem gewaehlten Betrieb abgeleitet. Zwei Filter, die dieselbe
  // Menge einschraenken, koennen einander widersprechen ("Betrieb =
  // Aposto Mainz" und "Marke = Enchilada"), und das Ergebnis ist eine
  // leere Seite ohne Fehlermeldung -- nicht zu unterscheiden von einem
  // Betrieb ohne Geschaeft. Genau die Falle, wegen der die Textfilter
  // ueberhaupt Auswahllisten bekommen haben.
  //
  // Ebenso KEIN Zeitraumfilter. Die Verlaufskarten lesen zwei
  // verschiedene Tabellen (Haus und Gruppe), und ein Metabase-Feldfilter
  // baut seine Klausel aus dem TABELLENNAMEN -- er wuerde nur einen der
  // beiden Aeste einschraenken und die Linien still verschieden lang
  // machen. Stattdessen ein festes 24-Monats-Fenster, das am
  // Monatsfilter haengt.
  // ===================================================================
  {
    schluessel: 'vg_marke',
    name: '⑨ Betrieb gegen Marke',
    beschreibung:
      'Ein Betrieb gegen den Schnitt seiner eigenen Marke: bricht der Umsatz nur hier ein oder in der ganzen Marke? Oben den Betrieb wählen — die Marke ergibt sich daraus.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# ⑨ Betrieb gegen Marke\n\nDie Frage vor jeder Maßnahme: **schwächelt dieses Haus oder seine ganze Marke?** Läuft die Marke mit nach unten, liegt es am Konzept, an der Saison oder am Markt — und eine Maßnahme im einzelnen Haus geht daneben.\n\nOben den **Betrieb** wählen; die Marke ergibt sich daraus. Ohne Auswahl steht hier die Gesamtübersicht: welche Häuser am weitesten unter ihrer eigenen Marke liegen.\n\nDer Markenwert ist immer der **mittlere Betrieb** der Marke, nicht der Mittelwert — ein einzelner Ausreißer soll den Maßstab nicht verziehen. Häuser ohne laufenden Umsatz zählen darin nicht mit.' }] },
      { teile: [{ karte: 'vm_kopf', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'vm_verlauf' }] },
      { teile: [{ text: '## Alle sechs Kennzahlen gegen die Marke\n\n„Stellung" sagt **besser** oder **schlechter**, nicht höher oder niedriger: bei Personal und Wareneinsatz ist weniger besser.' }] },
      { teile: [{ karte: 'vm_kennzahlen', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Die anderen Häuser der Marke\n\nEin ◀ markiert den oben gewählten Betrieb. Stehen die Nachbarn derselben Marke ebenso im Minus, ist der Befund keiner über dieses Haus.' }] },
      { teile: [{ karte: 'vm_haeuser', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'vg_stadt',
    name: '⑩ Betrieb gegen die Stadt',
    beschreibung:
      'Ein Betrieb gegen die anderen Häuser der Gruppe am selben Ort — verschiedene Marken, gleiches Einzugsgebiet. Trennt, was am Standort liegt, von dem, was am Haus liegt.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# ⑩ Betrieb gegen die Stadt\n\nIn Karlsruhe stehen vier Häuser der Gruppe: Aposto, Enchilada, Lehners und Wilma Wunder. Wetter, Baustellen, Feiertagslage und Kaufkraft treffen sie **gleichzeitig** — eine Marke über ganz Deutschland dagegen nicht. Deshalb ist die Stadt der zweite Maßstab neben der Marke.\n\nOben den **Betrieb** wählen; die Stadt ergibt sich daraus. Ohne Auswahl stehen in den Diagrammen die Städte selbst.\n\n> **Die Veränderung ist vergleichbar, die absoluten Quoten nur bedingt.** Die Häuser gehören verschiedenen Marken mit verschiedenen Karten, Preisen und Personalstrukturen. Ein Wareneinsatz von 24 % ist zwischen einem mexikanischen und einem bürgerlichen Konzept keine gemeinsame Messlatte — die Veränderung gegenüber dem Vorjahr trägt dagegen jedes Haus in seiner eigenen Einheit.' }] },
      { teile: [{ karte: 'vs_kopf', hoehe: 10,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Alle oder nur einer?\n\nDie Karte, wegen der es diese Seite gibt.' }] },
      { teile: [{ karte: 'vs_umsatz_pct', hoehe: 10 }] },
      { teile: [{ karte: 'vs_verlauf' }] },
      { teile: [{ text: '## Die Häuser der Stadt im Einzelnen' }] },
      { teile: [{ karte: 'vs_haeuser', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'vs_kennzahlen', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Wer im Vergleich fehlt\n\nDie Ortsangaben werden von Hand gepflegt — das Kassensystem liefert für Betriebe keine Adresse. Jedes Haus in dieser Liste fehlt in seiner Stadt, **ohne dass es dort auffiele**. Bleibt die Seite oben leer, steht der gewählte Betrieb hier.' }] },
      { teile: [{ karte: 'vs_fehlend', hoehe: 10,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
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

      { teile: [{ text: '## Betriebe ohne laufendes Geschäft\n\n> Betriebe ohne Umsatz verzerren **jeden** Durchschnitt. Seit dem 03.08.2026 fliegen sie deshalb aus Ampeln, Ranglisten und Marken-Medianen — hier stehen sie gesammelt: erst die still gewordenen (mit dem Umsatz, der wegfiel), dann die, die nie Umsatz hatten.' }] },
      { teile: [{ karte: 'pf_stillgelegt', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
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
    // Zwei Reiter: "Lage" ist der Einstieg (Karte, Zaehler, Betriebe),
    // "Marken" die Frage dahinter — schwaechelt das Haus oder seine Marke?
    // Vorher stand beides untereinander, und die Markenebene begann erst
    // nach vierzehn Reihen Scrollen.
    tabs: [
      { name: 'Lage', reihen: [
      { teile: [{ text: '# ① Round Table\n\n🟢 passt · 🟠 im Auge behalten · 🔴 sofort handeln · ⚪ nicht bewertbar (meist fehlt die BWA).\n\n**Round Table → Filiale → Betrieb.** Ein Klick führt eine Ebene tiefer, die Filter oben wandern mit. Gezählt werden nur **operative** Betriebe — geschlossene, verwaltende und Testbetriebe stehen in der eigenen Kachel und in ⑥ Portfolio.' }] },
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
        // Die Herausgenommenen duerfen nicht stumm verschwinden: wer die
        // Zaehler mit der Betriebsliste abgleicht, muss sehen, wohin die
        // uebrigen Haeuser gefallen sind.
        { karte: 'rt_kachel_nicht_operativ' },
      ] },
      // Neben der Bewertungskachel steht jetzt, WORAN sie haengt. Die Note
      // allein ist auf dieser Ebene eine Zahl ohne Griff -- "4,23" sagt
      // niemandem, was zu tun ist. "Bestellung · 2,14" schon, und ein Klick
      // fuehrt auf den Themenreiter, wo die Haeuser dahinter stehen.
      // Die Antwortquote daneben, weil sie das einzige auf dieser Seite
      // ist, das sich ohne Gast beeinflussen laesst.
      { teile: [
        { karte: 'rt_kachel_massnahmen',
          klick: [{ ziel: 'db_rt_ursachen', uebergabe: {}, fest: true }] },
        { karte: 'rt_kachel_bewertung' },
        { karte: 'yx_kachel_schwaechstes_thema',
          klick: [{ ziel: 'db_bewertung', uebergabe: {}, fest: true }] },
        { karte: 'yx_kachel_antwortquote',
          klick: [{ ziel: 'db_bewertung', uebergabe: {}, fest: true }] },
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
      ] },
      // ---------------------------------------------------------------
      // Die Markenebene. Sie stand bis zum 27.07.2026 auf einer eigenen
      // Seite "① Marken", dann bis zum 03.08.2026 UNTER der
      // Betriebstabelle — nach vierzehn Reihen Scrollen. Jetzt ein
      // eigener Reiter: dieselbe Seite, dieselben Filter, eine Frage.
      // Die Mediane rechnen seit Migration 0039 nur ueber OPERATIVE
      // Betriebe — vorher bestand "Besitos" aus einer Verwaltungs-GmbH
      // und einem Testladen, beide rot.
      // ---------------------------------------------------------------
      { name: 'Marken', reihen: [
      { teile: [{ text: '## Marken\n\nDie erste Frage vor jeder Maßnahme: schwächelt dieser eine Betrieb oder seine ganze Marke? Die Prozentwerte zeigen jeweils den mittleren **operativen** Betrieb der Marke — ein Ausreißer verzieht so nicht das Bild.' }] },
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
      ] },
    ],
  },

  {
    schluessel: 'db_rt_trend',
    name: 'Round Table — Trend und Ampelhistorie',
    beschreibung:
      'Wie sich die Ampeln über die Monate entwickelt haben. Die Vormonate und die Historie stehen automatisch zur Verfügung.',
    sammlung: 'Round Table',
    filter: [F_MONAT, F_MARKE],
    reihen: [
      { teile: [{ text: '# Trend und Historie\n\nWie sich die Ampeln über die Monate entwickelt haben. Die Historie schreibt sich von selbst fort und muss nicht gepflegt werden. Gezeigt werden die letzten 24 Monate, nur operative Betriebe.' }] },
      // Der Gesamtwechsel ZUERST: "welcher Betrieb ist als Ganzes
      // gekippt" ist die Eroeffnungsfrage jedes Round Table — bisher
      // zeigte die Seite nur Wechsel einzelner Bereiche.
      { teile: [{ text: '## Wessen Gesamturteil ist gekippt\n\nVerschlechterungen zuerst. Das ist die Liste, mit der ein Round Table anfängt.' }] },
      { teile: [{ karte: 'rt_gesamtwechsel', hoehe: 10,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [
        // Ein Segment heisst "die roten Betriebe im Maerz". Beides wandert
        // mit: der Monat von der Achse, die Bewertung aus der Farbe.
        { karte: 'rt_historie',
          klick: [{ ziel: 'dd_filialen', uebergabe: { monat: 'Monat', ampel: 'Ampelwert' } }] },
        { karte: 'rt_historie_bereich' },
      ] },
      { teile: [{ text: '## Wer hat die Farbe gewechselt — je Bereich\n\nWechsel einzelner Ampeln, Verschlechterungen zuerst. Feiner als das Gesamturteil oben: ein Haus kann insgesamt grün bleiben, während die Personalampel kippt.' }] },
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
    // Der Markenfilter kam am 03.08.2026: die Massnahmen-Kachel auf ①
    // zaehlt MIT Marke und klickt hierher — ohne den Filter landete
    // "5 offene Massnahmen (Enchilada)" auf einer Liste ALLER Marken,
    // die aussah wie die gefilterte (docs/fehlerkatalog.md).
    filter: [F_MONAT, F_MARKE],
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
    name: 'Umsatz — Entwicklung und Aktionen',
    beschreibung:
      'Umsatzentwicklung, Durchschnittsbon und Umsatz je Gast — und im zweiten Reiter die Marketingaktionen.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB, F_ZEITRAUM_JAHR],
    tabs: [
      { name: 'Entwicklung', reihen: [
      { teile: [{ text: '# Umsatz\n\nAlle Werte sind Nettowerte, also ohne Mehrwertsteuer. Durchschnittsbon und Umsatz je Gast werden unverändert aus LINA übernommen; „Ø je Gast" erscheint nur für Monate, in denen mindestens 80 % der Umsatztage eine Gästezahl tragen — sonst wäre die Zahl erfunden.\n\nVoreingestellt sind die letzten zwölf Monate.' }] },
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
      ] },
      // ---------------------------------------------------------------
      // Aktionen. mart.aktionsumsatz_monat lag seit Wochen fertig
      // aggregiert da — 4,6 Mio EUR "Feinsparten 2025", Happy-Hour-
      // Auswertungen — und keine einzige Karte las es. Ein eigener
      // Reiter statt eines eigenen Dashboards: Aktionsumsatz IST Umsatz,
      // und die Filter oben (Monat, Betrieb) gelten mit.
      // ---------------------------------------------------------------
      { name: 'Aktionen', reihen: [
      { teile: [{ text: '## Aktionen\n\nNur **34 der Betriebe** erfassen Aktionen — 19 davon Enchilada, 14 Wilma Wunder. Das ist keine Konzernsicht: Wer hier fehlt, fährt vielleicht dieselbe Aktion und bucht sie nur nicht. Alle Werte netto; der laufende Monat ist unvollständig.' }] },
      { teile: [{ karte: 'ak_uebersicht', hoehe: 10 }] },
      { teile: [{ karte: 'ak_verlauf', hoehe: 9 }] },
      { teile: [{ text: '### Wer hängt woran\n\nDer gewählte Monat, sortiert nach **Anteil am eigenen Umsatz**: 40 % Aktionsanteil sind eine andere Nachricht als 4.000 € — dieses Haus hat eine Frage zu beantworten, wenn die Aktion endet.' }] },
      { teile: [{ karte: 'ak_betrieb', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '### Geplant und tatsächlich\n\n„—" heißt unbefristet. Der Steckbrief zeigt, was das Umsatzbild nicht zeigt: Aktionen, die **nie Umsatz sahen**, und unbefristete, die **seit Jahren still weiterlaufen**.' }] },
      { teile: [{ karte: 'ak_steckbrief', hoehe: 10 }] },
      ] },
    ],
  },

  {
    schluessel: 'db_struktur',
    name: 'Umsatz — Struktur',
    beschreibung:
      'Woher der Umsatz kommt: nach Speisen und Getränken, nach Tageszeit und im Wochenprofil.',
    sammlung: 'Betrieb',
    // Monat UND Zeitraum, und das ist kein Versehen: die beiden Tabellen
    // unten zeigen einen Stichmonat je Betrieb, die Diagramme darueber
    // einen Verlauf. Der Zeitraum grenzt ein, welche Tage einfliessen --
    // Vorgabe drei Monate, damit das Tagesprofil einen Rhythmus zeigt
    // statt 8,5 Jahre inklusive Corona zu mitteln.
    //
    // "Umsatz je Verkaufsstelle" ist am 03.08.2026 entfallen: LINA
    // liefert die Dimension nicht (in allen 884.352 Zeilen NULL), die
    // Karte war seit je leer und las sich als "kein Ausser-Haus-
    // Geschaeft".
    filter: [F_MONAT, F_BETRIEB, F_ZEITRAUM_DREI_MONATE],
    reihen: [
      { teile: [{ text: '# Struktur des Umsatzes\n\nBisher werden nur die Sparten **Speisen** und **Getränke** geliefert. Ihre Summe ist deshalb kleiner als der Gesamtumsatz — es fehlt nichts in der Rechnung, sondern in den gelieferten Daten.\n\nVoreingestellt sind die letzten drei Monate.' }] },
      { teile: [
        { karte: 'st_sparte' },
      ] },
      { teile: [{ karte: 'st_sparte_anteil', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Tageszeit\n\nDer Geschäftstag läuft von 08:00 bis 07:59 des Folgetags. Die Nachtstunden gehören deshalb ans **Ende** des Tages, nicht an den Anfang.' }] },
      // Der Stundenverlauf allein auf voller Breite -- vierundzwanzig
      // Balken auf vierzehn Einheiten liessen Metabase alle Uhrzeiten
      // weglassen. Die Zeitzonen (fuenf Kategorien) darunter.
      { teile: [
        { karte: 'st_stunde' },
      ] },
      { teile: [{ text: '## Wochenprofil\n\nStunde × Wochentag — das Werkzeug für den Dienstplan. Mit gewähltem Betrieb: Wo liegen DIESE Spitzen? Ohne: das Konzernmuster.' }] },
      { teile: [{ karte: 'st_wochenprofil', hoehe: 13 }] },
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
      // ZWEI PERSONALKOSTENGROESSEN, EINE SEITE. Der Text darunter ist der
      // wichtigste auf diesem Dashboard: pe_bereich stellt "Personal
      // gesamt %" (operativ, aus der Kasse) und "o. GF %" (vom
      // Steuerberater) NEBENEINANDER in eine Tabelle. Ohne Erklaerung liest
      // man das als dieselbe Zahl in zwei Fassungen -- und wundert sich
      // ueber die Abweichung, statt sie zu deuten. Gefragt am 04.08.2026.
      { teile: [{ text: '# Personal\n\n**Zwei verschiedene Personalkosten-Größen stehen auf dieser Seite. Sie sind nicht ineinander umrechenbar:**\n\n**„Personal o. GF %" — die Ampel-Größe.** Personalkosten **ohne Geschäftsführung**, aus der **BWA des Steuerberaters**, in % vom Umsatz. Nur an dieser Zahl hängt die Ampel „Personal" im Round Table (grün bis 28 %). Sie ist die verbindliche Zahl aus dem Round-Table-Regelwerk.\n\n**„Personal gesamt %" — die operative Größe.** Die Kosten der drei Bereiche **Service, Bar und Küche** aus dem Kassensystem, ebenfalls in % vom Umsatz. GF-Gehälter, Verwaltung und alles außerhalb dieser drei Bereiche stecken **nicht** darin. Sie sagt, **wo** es klemmt — nicht, ob die Ampel kippt.\n\nDass beide voneinander abweichen, ist der Normalfall: die eine ist gebuchte BWA, die andere der laufende Betrieb.\n\n**Quote** = in % vom Umsatz (was Personal kostet). **Umsatz je Personalstunde** = in Euro (was eine Arbeitsstunde einbringt). Im LINA-Bericht heißen beide „Effektivität" — deshalb stehen sie getrennt.\n\nQuoten haben den Umsatz im Nenner: an umsatzschwachen Tagen werden sie beliebig groß. Deshalb wird hier mit dem **Median** gerechnet und ohne Betriebe ohne laufendes Geschäft.' }] },
      { teile: [{ karte: 'pe_quote_betrieb', hoehe: 11, klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pe_quote_tabelle', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pe_verlauf' }] },
      { teile: [{ karte: 'pe_bereich', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pe_effektivitaet', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_ware',
    name: 'Warenwirtschaft — Artikel und Deckungsbeitrag',
    beschreibung:
      'Was gut und was kaum läuft, und der Deckungsbeitrag je Warengruppe — als Umsatzgliederung, nicht als Margenaussage. Die echten Einkaufspreise stehen auf dem Einkaufs-Dashboard.',
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
      // Eigener Abschnitt statt Einreihung neben den Preiskarten: der
      // Vorbehalt (nur Wilma Wunder belastbar) braucht eine eigene
      // Textkachel, sonst liest jemand die Rangliste als flaechige
      // Marken-Aussage -- genau der Fehlschluss, vor dem die
      // Kartenbeschreibung schon warnt, aber eine Ueberschrift auf der
      // Seite selbst sieht niemand ueber.
      { teile: [{ text: '## Inventur und Schwund\n\n**Nur bei Wilma Wunder belastbar** — nur dort gibt es genug echte Inventuren für eine Aussage. Bei den anderen drei Marken sind es zu wenige, um daraus einen Schwundwert für die ganze Marke abzuleiten. Stornierte und noch nicht signierte Zählungen zählen nicht mit.' }] },
      { teile: [{ karte: 'wa_inventur_schwund', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      // Der Verweis ans Ende, nicht nach oben: diese Seite beantwortet
      // "was hat der Einkauf gekostet", die andere "durfte dort ueberhaupt
      // gekauft werden". Zwei Fragen, und die zweite stellt man, nachdem
      // man die erste gesehen hat. Die Kachel traegt bewusst KEINEN
      // Markenfilter — hier oben steht der FoodNotify-Mandant, drueben das
      // Konzept, siehe Kopf von fe_kachel_verweis.
      { teile: [{ text: '## Durfte dort eingekauft werden?\n\nDie Frage nach dem **Lieferanten** statt nach dem Preis: Wareneinkauf bei Firmen, die weder auf der Konzernfreigabe stehen noch der hinterlegte GFGH ihres Hauses sind. Grundlage ist das **Belegarchiv** — die Rechnungen selbst, nicht die Bestellungen. Das ist der Unterschied, auf den es hier ankommt: wer bei einem nicht freigegebenen Lieferanten kauft, bestellt ihn nicht über FoodNotify.' }] },
      { teile: [{ karte: 'fe_kachel_verweis', breite: 8,
        klick: [{ ziel: 'db_fremdeinkauf', uebergabe: {}, fest: true }] }] },
    ],
  },

  // ---------------------------------------------------------------------
  // Fremdeinkauf. Eigene Seite und kein Reiter auf db_einkauf, weil die
  // Datenbasis eine andere ist: db_einkauf steht auf FoodNotify-
  // Bestellungen, diese Seite auf dem Belegarchiv. Dieselbe Seite mit zwei
  // Quellen haette bei jeder Zahl die Frage aufgeworfen, welche gemeint
  // ist — und die falsche Antwort waere gewesen, sie zu addieren.
  // ---------------------------------------------------------------------
  {
    schluessel: 'db_fremdeinkauf',
    name: 'Fremdeinkauf — wer liefert, obwohl er nicht darf',
    beschreibung:
      'Wareneinkauf bei nicht freigegebenen Lieferanten, je Betrieb und Lieferant, aus dem Belegarchiv und aus FoodNotify getrennt. Dazu der Preisvergleich zwischen den Häusern — die Auswertung, die „GFGH Q2 2026.xlsx" von den Betrieben erfragen wollte und zu 8,7 % zurückbekam.',
    sammlung: 'Betrieb',
    // Das Konzept, nicht der FoodNotify-Mandant: mart.fremdeinkauf und
    // mart.einkaufspreis_betrieb tragen beide konzept aus
    // mart.konzept_zuordnung.
    filter: [F_BETRIEB, F_MARKE],
    reihen: [
      { teile: [{ text: '# Fremdeinkauf\n\n**Drei Dinge vorweg, sonst liest man die Zahlen falsch.**\n\n**Die Quelle steht in jeder Tabelle und wird nie summiert.** Dieselbe Rechnung steht in FoodNotify *und* im Belegarchiv. Wer über die Spalte „Quelle" summiert, zählt sie doppelt. Die Kacheln und Diagramme zeigen deshalb ausschließlich das **Belegarchiv** — dort ist Fremdeinkauf überhaupt erst sichtbar, denn wer bei einem nicht freigegebenen Lieferanten kauft, bestellt ihn nicht über das Bestellsystem des Konzerns.\n\n**Es zählt nur Wareneinkauf.** Das Belegarchiv führt alle Eingangsrechnungen — Strom, Leasing, Finanzamt, Kartengebühren, Rechnungen zwischen Konzerngesellschaften. Das ist herausgerechnet und steht weiter unten nachprüfbar daneben.\n\n**Die Liste ist eine Arbeitsliste, kein Urteil.** Wer nicht auf der Freigabeliste steht, erscheint hier — auch die Brauerei mit Liefervertrag und der Winzer. Sie gehören in `manual.lieferant_freigabe` eingetragen; dann verschwinden sie. Die Liste schrumpft, während man sie abarbeitet.' }] },
      { teile: [
        { karte: 'fe_summe' },
        { karte: 'fe_ungeklaert' },
        { karte: 'fe_betriebe_betroffen' },
      ] },
      { teile: [{ text: '## Bei wem\n\nNach Volumen sortiert: oben lohnt die Entscheidung am meisten. Die Tabelle darunter zeigt beide Quellen getrennt und nennt den Grund — „steht nicht auf der Liste" heißt, noch niemand hat entschieden; „ausdrücklich gesperrt" heißt, jemand hat entschieden.' }] },
      { teile: [{ karte: 'fe_lieferant', hoehe: 11 }] },
      { teile: [{ karte: 'fe_lieferant_tabelle', hoehe: 12 }] },
      { teile: [{ text: '## In welchem Haus\n\nDer **Anteil** ist die aussagekräftigere Spalte: ein großes Haus mit 5 % hat ein kleineres Problem als ein kleines mit 50 %. Steht in der letzten Spalte ein GFGH, ist dessen Belieferung freigegeben und hier nicht mitgezählt.' }] },
      { teile: [{ karte: 'fe_betrieb', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      // Beide Richtungen des Ausschlusses stehen auf der Seite. Eine
      // herausgerechnete Menge dieser Groesse (44 Mio ungeklaert, 29,8 Mio
      // aussortiert) unsichtbar zu lassen, waere eine stille Kuerzung --
      // und die Zahl oben saehe nach einem Ergebnis aus statt nach einer
      // Untergrenze.
      { teile: [{ text: '## Was nicht mitgezählt wurde\n\nBeide Richtungen, damit die Zahl oben prüfbar ist. **Oben fehlt, was noch niemand eingeordnet hat** — das ist die Arbeitsliste, und solange sie groß ist, ist der Fremdeinkauf oben eine Untergrenze. **Unten fehlt, was kein Wareneinkauf ist** — das ist beabsichtigt.' }] },
      { teile: [{ karte: 'fe_arbeitsliste', hoehe: 12 }] },
      { teile: [{ karte: 'fe_kein_wareneinkauf', hoehe: 10 }] },
      { teile: [{ text: '## Stand der Freigabeliste\n\nKonzernweit, deshalb ohne Betriebsfilter. „Trifft nichts" heißt: der Eintrag steht in der Liste, aber unter diesem Namen wurde nie eingekauft — meist ein Schreibweisenproblem, kein leerer Lieferant.' }] },
      { teile: [{ karte: 'fe_freigabestand', hoehe: 12 }] },
      { teile: [{ text: '## Preisvergleich zwischen den Häusern\n\nDie eigentliche Excel-Frage: was zahlt *dieses* Haus, und wie stehen die anderen da. Aus **FoodNotify**, nicht aus dem Belegarchiv — nur dort stehen einzelne Artikel.\n\n**Belastbar ist das im einstelligen bis niedrig zweistelligen Prozentbereich.** Dreistellige Abweichungen sind meist Mengenartefakte: die Häuser buchen dieselbe Ware verschieden. Vier Sperren fangen das ab, die letzte stumpf bei Faktor 3. Wer eine große Abweichung weitergibt, prüft sie vorher am Beleg.\n\n**Mehrkosten sind eine Obergrenze, keine Einsparzusage.** Der Median ist ein erreichter Preis, kein zugesagter.' }] },
      { teile: [{ karte: 'ep_abweichung', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'ep_betrieb', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'ep_nicht_vergleichbar', hoehe: 9 }] },
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
      // Der Wasserfall daneben waere zu schmal: "Uebrige Kosten" braucht
      // eine lesbare Beschriftung, und die Bloecke sollen proportional
      // erkennbar sein.
      { teile: [{ text: '## Vom Umsatz zum Ergebnis\n\nDie vier Blöcke zwischen Umsatz und EBIT. „Übrige Kosten" ist der Rest — Miete, Energie, GF-Gehälter, Abschreibungen. Mit gewähltem Betrieb wird daraus die Ergebnisrechnung dieses Hauses.' }] },
      { teile: [{ karte: 'bwa_wasserfall', hoehe: 10 }] },
      { teile: [{ karte: 'bwa_ebit', hoehe: 11, klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Buchungsstand\n\nZwei Monate Verzug sind normal, vier eine Nachfrage beim Steuerberater wert.' }] },
      { teile: [{ karte: 'bwa_buchungsstand', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_bewertung',
    name: 'Online-Bewertungen — was Gäste sagen',
    beschreibung:
      'Die einzige der sechs Round-Table-Kennzahlen, die nicht aus unseren eigenen Systemen '
      + 'kommt. Stand, Bewegung und die Betriebe, bei denen die neuen Bewertungen schlechter '
      + 'ausfallen als ihr eigener Ruf. Der Reiter **Themen** sagt, woran es liegt — '
      + 'Küche, Service, Wartezeit, Bestellung, Sauberkeit.',
    sammlung: 'Betrieb',
    // Kein Betriebsfilter im Kopf: dieses Dashboard ist die Uebersicht
    // ueber alle. Wer einen einzelnen Betrieb sucht, klickt ihn an und
    // landet auf ③ Betrieb, wo der Verlauf noch einmal steht.
    filter: [F_MONAT, F_MARKE],
    // Drei Reiter entlang der drei Fragen: Wie stehen wir da? Wo kippt
    // es gerade? Und kann ich den Zahlen trauen?
    tabs: [
      { name: 'Stand', reihen: [
      { teile: [{ text: '# Online-Bewertungen\n\nQuelle ist Yext, geladen einmal täglich. **Stand** = Schnitt über alle Bewertungen bis Monatsende, das was ein Gast auf Google sieht — daran hängt die Ampel (grün ab 4,40, orange ab 4,00). **Ø neu** = wie die Bewertungen ausfielen, die in diesem Monat kamen; die Kurve darunter glättet das über sechs Monate zur **Tendenz**.\n\nGerechnet wird auf Google: Facebook führt Bewertungen ohne Sternewertung, ein Schnitt über alle Portale mischt zwei Skalen.' }] },
      { teile: [
        { karte: 'bw_kachel_schnitt' },
        { karte: 'bw_kachel_monatswert' },
        { karte: 'bw_kachel_neue' },
      ] },
      { teile: [{ karte: 'bw_verlauf', hoehe: 10 }] },
      { teile: [{ karte: 'bw_marke', hoehe: 10,
        klick: [{ ziel: 'dd_filialen', uebergabe: { marke: 'Marke' } }] }] },
      { teile: [{ text: '## Alle Betriebe\n\nSchlechteste zuerst. Jede Spaltenüberschrift sortiert — für die Bestenliste einmal auf **Stand** klicken. Nur operative Betriebe.' }] },
      { teile: [{ karte: 'bw_rangliste', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      ] },
      // Der Reiter, der die Frage von 10.08.2026 beantwortet: die Note
      // sagt DASS ein Haus abrutscht, die Themen sagen WORAN. Er steht
      // direkt hinter "Stand", weil das die Reihenfolge ist, in der
      // gefragt wird -- nicht hinter den technischen Reitern.
      { name: 'Themen', reihen: [
      { teile: [{ text: '# Woran es liegt\n\nYext klassifiziert die Bewertungstexte selbst. Fünf Themen, jedes mit der Durchschnittsnote **der Bewertungen, die es ansprechen** — „Bestellung 2,1“ heißt: wer über die Bestellung schrieb, vergab im Schnitt 2,1 Sterne.\n\nZwei Dinge, die man wissen muss: die Klusterung beginnt **im April 2026**, ein Vorjahresvergleich ist also noch nicht möglich. Und eine Bewertung kann **mehrere Themen** tragen — die Anteile ergeben zusammen mehr als 100 %, und das ist richtig.' }] },
      { teile: [
        { karte: 'yx_kachel_schwaechstes_thema' },
        { karte: 'yx_kachel_anteil_schlecht' },
        { karte: 'yx_kachel_offen' },
      ] },
      { teile: [{ karte: 'yx_themen', hoehe: 9 }] },
      { teile: [{ text: '## Im Verlauf\n\nEin Thema, das kippt, ist hier sichtbar, lange bevor der Bewertungsstand darauf reagiert. Der Anstieg im April 2026 ist der Beginn der Erhebung, kein Ereignis.' }] },
      { teile: [{ karte: 'yx_themen_verlauf', hoehe: 9 }] },
      { teile: [{ text: '## Themenprofil je Betrieb\n\nJede Spaltenüberschrift sortiert. **Schwachpunkt** ist das Thema, das am weitesten unter dem eigenen Schnitt des Hauses liegt — nicht das mit der kleinsten Note: ein Haus mit lauter Vieren hat kein Wartezeitproblem, nur weil die Wartezeit bei 3,9 steht.' }] },
      { teile: [{ karte: 'yx_themen_betrieb', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Wo ein Thema am weitesten abfällt\n\nDie Arbeitsliste: nicht „welches Haus ist schlecht“, sondern „welches Haus ist **wobei** schlecht“. Erst ab drei Nennungen — darunter wäre der Abstand die Meinung eines einzelnen Gastes.' }] },
      { teile: [{ karte: 'yx_themen_ausreisser', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Datengrundlage\n\nLinks der Zeitraum, den die Klusterung abdeckt. Rechts eine Liste, die **leer sein sollte**: Themen, die Yext liefert und die die Tabelle oben nicht kennt. Steht dort etwas, hat jemand im Yext-Konto ein Label ergänzt.' }] },
      { teile: [
        { karte: 'yx_themen_stand', breite: 11, hoehe: 9 },
        { karte: 'yx_themen_unbekannt', breite: 13, hoehe: 9 },
      ] },
      ] },
      { name: 'Frühwarnung', reihen: [
      // Zwei Fruehwarnungen mit verschiedener Mechanik: bw_bewegung
      // vergleicht den Monatsschnitt mit dem eigenen Ruf (Mittelwert),
      // bw_anteil_schlecht zaehlt die 1-2-Sterne-Faelle (Anteil). Der
      // Anteil schlaegt frueher aus: drei wuetende Bewertungen bewegen
      // einen 4,4er-Schnitt kaum, den Schlecht-Anteil sehr wohl.
      { teile: [{ text: '## Frühwarnung — wo es gerade kippt\n\nBei mehreren tausend Bewertungen bewegt ein schlechter Monat den **Stand** nur um Hundertstel. Die Ampel bleibt grün, während sich vor Ort etwas ändert. Zwei Sichten auf denselben Verdacht: oben der Monatsschnitt gegen den eigenen Ruf, unten der **Anteil der 1–2-Sterne-Bewertungen** der letzten 90 Tage gegen die zwölf Monate davor — das schärfere Signal.' }] },
      { teile: [{ karte: 'bw_bewegung', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'bw_anteil_schlecht', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      ] },
      // Antwortverhalten und Sichtbarkeit kommen aus derselben Yext-API
      // wie die Themen, beantworten aber andere Fragen: was TUN wir mit
      // dem, was Gaeste sagen -- und finden sie uns ueberhaupt.
      { name: 'Antworten', reihen: [
      { teile: [{ text: '# Was wir damit tun\n\nWer auf Bewertungen antwortet und wie schnell. Bis heute war das nirgends sichtbar: einzelne Häuser antworten **gar nicht**, während andere über 90 % erreichen — im Konzernschnitt verschwindet der Unterschied.\n\nDie Reaktionszeit zählt ab der Bewertung. Wo nicht geantwortet wurde, bleibt sie leer und steht **nicht** auf null — sonst stünden genau die Häuser ohne Antwort an der Spitze der Bestenliste.' }] },
      { teile: [
        { karte: 'yx_kachel_antwortquote' },
        { karte: 'yx_kachel_offen' },
      ] },
      { teile: [{ karte: 'yx_antwort_rangliste', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'yx_antwort_verlauf', hoehe: 9 }] },
      { teile: [{ text: '## Notenverteilung\n\nDer **Anteil der 1–2-Sterne-Bewertungen** ist die robustere Ampel: bei mehreren tausend Altbewertungen bewegt ein schlechter Monat den Stand um Hundertstel, diesen Anteil sofort.' }] },
      { teile: [{ karte: 'yx_note_verteilung', hoehe: 9 }] },
      { teile: [{ karte: 'yx_note_rangliste', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      ] },
      { name: 'Sichtbarkeit', reihen: [
      { teile: [{ text: '# Findet man uns?\n\nEine von den Bewertungen **unabhängige** Datenquelle: wie oft die Einträge eines Betriebs in den Portalen ausgespielt werden, wie oft danach gesucht und geklickt wird — und wie gepflegt die Einträge sind.\n\n**Diese Zahlen hinken.** Bewertungen sind bis gestern vollständig, die Sichtbarkeitszahlen bis zu einer Woche älter; der laufende Monat ist hier immer ein Teilmonat. Die Tabelle ganz unten sagt, wie alt jede Zahl ist.' }] },
      { teile: [
        { karte: 'yx_sicht_kachel_impressionen' },
        { karte: 'yx_sicht_kachel_genauigkeit' },
      ] },
      { teile: [{ karte: 'yx_sicht_trichter', hoehe: 9 }] },
      { teile: [{ text: '## Gegen vergleichbare Betriebe\n\nYext liefert zu jedem Haus den Median vergleichbarer Betriebe. **Faktor** unter 1 heißt: dieses Haus wird seltener gesehen als vergleichbare. Häuser ohne Vergleichsgruppe fehlen in der Liste — bei Yext ist das eine Leerstelle, kein guter Wert.' }] },
      { teile: [{ karte: 'yx_sicht_benchmark', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Pflegezustand\n\nEine Arbeitsliste fürs Marketing. **Genauigkeit** ist der Anteil der Portaleinträge, die mit unseren Stammdaten übereinstimmen — unter 90 % heißt, dass Gäste dort Öffnungszeiten oder Nummern finden, die nicht stimmen.' }] },
      { teile: [{ karte: 'yx_sicht_pflege', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'yx_datenstand', hoehe: 9 }] },
      ] },
      { name: 'Portale & Abdeckung', reihen: [
      { teile: [{ text: '## Wenn jemand fragt, warum Google\n\nDie Portalwahl entscheidet bei manchen Betrieben über die Ampelfarbe. Gespeichert ist beides, umgestellt wird in einer Funktion — nicht durch einen neuen Import. Die zweite Tabelle zeigt jedes Portal einzeln: TripAdvisor bewertet strukturell strenger, ein Portal-Mix wäre deshalb keine Note, sondern ein Zufall der Gewichte.' }] },
      { teile: [{ karte: 'bw_portale', hoehe: 11 }] },
      { teile: [{ karte: 'bw_portalvergleich', hoehe: 9 }] },
      { teile: [{ text: '## Wem fehlen Bewertungen?\n\nOperative Betriebe ohne Yext-Zuordnung — ihre Ampel bleibt grau, egal was die Gäste sagen. Diese Liste sollte leer werden.' }] },
      { teile: [{ karte: 'bw_fehlend', hoehe: 9,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'bw_ladestand', hoehe: 9 }] },
      ] },
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
      // Der Anlassfall: am 22.07.2026 hatte kein einziger der 141
      // Betriebe Umsatz — ein ganztaegiges Importloch, zwoelf Tage alt,
      // und keine Karte meldete es. Jeder Verlauf zeigte einen
      // erfundenen Absturz auf null.
      { teile: [{ karte: 'dq_lochtage', hoehe: 9 }] },
      { teile: [{ karte: 'dq_unplausibel', hoehe: 10 }] },
      { teile: [
        { karte: 'dq_umsatz_abweichung', hoehe: 11,
          klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
      { teile: [{ text: '## Wem fehlt was?\n\nDie folgenden Tabellen sind Arbeitslisten. **Die Liste der Betriebe ohne Zuordnung zum Steuerberater sollte leer sein.**' }] },
      { teile: [{ karte: 'dq_datenstand', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'dq_ohne_bruecke' }] },
      { teile: [{ karte: 'dq_zuordnung_offen', hoehe: 9 }] },
      { teile: [{ karte: 'dq_gaeste', hoehe: 10 }] },
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

      { teile: [{ text: '## Wie vollständig ist es?\n\n**„Tage alt“** zeigt einen hängenden Bericht — ein bis zwei Tage sind normal. **„wartet“** heißt nicht kaputt: laufender Betrieb geht vor Historie.\n\nDaneben die beiden anderen Quellen: **FoodNotify** (Bestellseiten je Kostenstelle, chronologisch aufsteigend) und **Yext** (Bewertungen, einmal täglich — älter als ~28 Stunden ist eine Nachfrage wert).' }] },
      { teile: [{ karte: 'im_bericht', hoehe: 11 }] },
      { teile: [{ karte: 'im_foodnotify', hoehe: 9 }] },
      { teile: [{ karte: 'im_yext', hoehe: 9 }] },
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
      'Alle Standorte mit hinterlegten Koordinaten auf einer Karte, eingefärbt nach dem Handlungsbedarf des gewählten Monats. Ein Klick auf einen Punkt öffnet die Detailseite des Betriebs.',
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
