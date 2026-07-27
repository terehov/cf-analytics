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
const F_ZEITRAUM: Parameter = {
  id: 'd-zeitraum', name: 'zeitraum', 'display-name': 'Zeitraum', type: 'date/all-options',
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
  {
    schluessel: 'dd_marken',
    name: '① Marken',
    beschreibung:
      'Der Einstieg. Eine Zeile je Marke mit allen Kennzahlen und der Ampelverteilung. Ein Klick auf den Markennamen öffnet die Filialen dieser Marke.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT],
    reihen: [
      { teile: [{ text: '# ① Marken\n\nDer Einstieg in die Kette **Marke → Filiale → Betrieb**. Ein Klick auf einen Markennamen führt eine Ebene tiefer.\n\nDie Prozentwerte zeigen jeweils den **mittleren Betrieb** einer Marke, nicht den rechnerischen Durchschnitt. Ein einzelner Ausreißer — etwa ein geschlossenes Haus mit über 1000 % Personalquote — verzieht damit nicht das Bild der ganzen Marke.' }] },
      { teile: [{ karte: 'dd_marken_tabelle', klick: [{ ziel: 'dd_filialen', spalte: 'Marke', uebergabe: { marke: 'Marke' } }] }] },
      { teile: [
        { karte: 'dd_marken_ampeln', klick: [{ ziel: 'dd_filialen', uebergabe: { marke: 'Marke' } }] },
        { karte: 'dd_marken_verlauf' },
      ] },
      { teile: [{ text: '## Marken nebeneinander\n\nJede Marke in jeder Kennzahl, mit dem Abstand zum Mittelfeld aller Betriebe. So wird sichtbar, ob eine Marke durchgehend schwächer ist oder nur in einer Disziplin.' }] },
      { teile: [
        { karte: 'pf_marken_matrix' },
        { karte: 'pf_marken_umsatzanteil' },
      ] },
    ],
  },

  {
    schluessel: 'dd_filialen',
    name: '② Filialen',
    beschreibung:
      'Alle Betriebe — oder nur die einer Marke, wenn man von Ebene ① kommt — über sämtliche Kennzahlen mit Ampeln. Ein Klick auf den Betriebsnamen öffnet die Detailseite.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_MARKE],
    reihen: [
      { teile: [{ text: '# ② Filialen\n\nAlle Betriebe über sämtliche Kennzahlen. Kommt man von ① Marken, ist der Marken-Filter oben bereits gesetzt — **wird er geleert, erscheinen wieder alle Betriebe**.\n\nEin Klick auf einen Betriebsnamen öffnet die Detailseite. Ein weißer Punkt ⚪ heißt **keine Daten**, nicht „in Ordnung".' }] },
      { teile: [{ karte: 'dd_filialen_tabelle', hoehe: 12, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [
        { karte: 'dd_filialen_metrikvergleich', breite: 10 },
        { karte: 'dd_filialen_rangliste', breite: 14, hoehe: 11,
          klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
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
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# ③ Betrieb\n\nAlles zu einem Betrieb auf einer Seite. **Bitte zuerst unten auf „Datenstand" sehen** — ohne zu wissen, wie aktuell die Zahlen sind, bleibt jeder Schluss von hier oben eine Vermutung.\n\nJedes Diagramm führt per Klick in die passende Detailauswertung, der Betrieb ist dort bereits ausgewählt.' }] },
      { teile: [
        { karte: 'dd_betrieb_umsatz_kachel' },
        { karte: 'dd_betrieb_ytd_kachel' },
        { karte: 'dd_betrieb_gaeste_kachel' },
        { karte: 'dd_betrieb_bon_kachel' },
      ] },
      { teile: [{ text: '## Die sechs Kennzahlen des Round Table\n\nJeweils mit Vormonat, Veränderung und Ampelwechsel.' }] },
      { teile: [{ karte: 'dd_betrieb_kopf' }] },
      { teile: [
        { karte: 'dd_betrieb_verlauf', breite: 14,
          klick: [{ ziel: 'db_umsatz', uebergabe: { betrieb: 'Betrieb' } }] },
        { karte: 'dd_betrieb_ampelverlauf', breite: 10 },
      ] },
      { teile: [{ text: '## Struktur — wovon dieser Betrieb lebt' }] },
      { teile: [
        { karte: 'dd_betrieb_sparte', klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },
        { karte: 'dd_betrieb_zeitzone', klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },
        { karte: 'dd_betrieb_stunde', klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
      { teile: [{ text: '## Personal, Ware, BWA' }] },
      { teile: [{ karte: 'dd_betrieb_personal',
        klick: [{ ziel: 'db_personal', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [
        { karte: 'dd_betrieb_artikel', klick: [{ ziel: 'db_ware', uebergabe: { betrieb: 'Betrieb' } }] },
        { karte: 'dd_betrieb_bwa', klick: [{ ziel: 'db_bwa', uebergabe: { betrieb: 'Betrieb' } }] },
      ] },
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
      { teile: [{ text: '# ④ Zeiträume vergleichen\n\nOben vier Datumsfelder: **Zeitraum A** gegen **Zeitraum B**. Ohne Eingabe steht der laufende Monat bis heute gegen denselben Ausschnitt des Vormonats — ein voller Monat gegen einen halben wäre kein fairer Vergleich.\n\n> **Bitte auf die Tage-Spalten achten.** Zeiträume unterschiedlicher Länge lassen sich vergleichen, aber dann steckt in der Differenz auch die unterschiedliche Anzahl Tage.' }] },
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
    filter: [F_MONAT, F_BETRIEB, F_MARKE],
    reihen: [
      { teile: [{ text: '# ⑤ Standorte vergleichen\n\nOben Betrieb oder Marke auswählen. Ohne Auswahl stehen hier alle — für einen aussagekräftigen Vergleich zwei bis vier Betriebe wählen.\n\nDer Tagesverlauf zeigt **Prozent vom eigenen Tagesumsatz**. Sonst vergleicht man nur die Größe der Häuser und nicht ihr Muster.' }] },
      { teile: [{ karte: 'vg_ort_metriken', hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [
        { karte: 'vg_ort_umsatz' },
        { karte: 'vg_ort_profil' },
      ] },
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

      { teile: [{ text: '## Wo steckt der Umsatz\n\nJe stärker sich der Umsatz auf wenige Häuser konzentriert, desto schwerer wiegt dort eine Störung — und desto weniger bringt ein Prozentpunkt Verbesserung bei einem kleinen Haus.\n\n> **Wichtig für alle Anteile auf dieser Seite:** Ein großer Teil der geführten Betriebe macht gar keinen Umsatz und liefert täglich Berichte über 0 €. Wie viele es aktuell sind, steht in der Kachel weiter unten.' }] },
      { teile: [{ karte: 'pf_kachel_aktiv' }] },
      { teile: [
        { karte: 'pf_konzentration_kurve', breite: 10 },
        { karte: 'pf_konzentration', breite: 14, hoehe: 11 },
      ] },

      { teile: [{ text: '## Was wäre zu holen\n\nDie Spalte „€ bis Median" ist **kein Ziel und keine Prognose**, sondern eine Größenordnung: was der Abstand zum Mittelfeld in Euro bedeutet. Sortiert nach eben diesem Betrag — oben stehen die Betriebe, bei denen sich Arbeit am meisten lohnt.' }] },
      { teile: [{ karte: 'pf_potenzial', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pf_streuung' }] },

      { teile: [{ text: '## Betriebe ohne laufendes Geschäft\n\n> Betriebe ohne Umsatz verzerren **jeden** Durchschnitt und erzeugen unsinnige Quoten: über 1000 % Personalkosten bei 0 € Umsatz melden eine Katastrophe, wo gar kein Betrieb läuft. Diese Liste ist die Vorlage, um solche Einträge auf inaktiv zu setzen.' }] },
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

      { teile: [{ text: '## Wie planbar läuft ein Betrieb\n\nWie stark der Tagesumsatz im Verhältnis zum eigenen Durchschnitt schwankt — dadurch sind große und kleine Häuser vergleichbar. Ein hoher Wert heißt Abhängigkeit von Wochenenden, Veranstaltungen oder Wetter und macht die Personalplanung teuer.' }] },
      { teile: [{ karte: 'pf_stabilitaet', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  // ===================================================================
  // ROUND TABLE — die Excel-Abloesung
  // ===================================================================
  {
    schluessel: 'db_round_table',
    name: 'Round Table — Übersicht',
    beschreibung:
      'Die Übersicht für den monatlichen Round Table: oben die Zähler, darunter woran es liegt, unten die vollständige Betriebstabelle.',
    sammlung: 'Round Table',
    filter: [F_MONAT, F_MARKE],
    reihen: [
      { teile: [{ text: '# Round Table\n\nDie Ampeln: 🟢 passt · 🟠 im Auge behalten · 🔴 sofort handeln.\n\n**„Ohne Urteil"** sind Betriebe, für die sich keine Ampel berechnen ließ — meist fehlen die Zahlen vom Steuerberater. Sie stehen bewusst als eigene Gruppe da, damit sie nicht mit unauffälligen Betrieben verwechselt werden.' }] },
      { teile: [
        { karte: 'rt_kachel_rot' },
        { karte: 'rt_kachel_orange' },
        { karte: 'rt_kachel_gruen' },
        { karte: 'rt_kachel_ohne_urteil' },
        { karte: 'rt_kachel_massnahmen' },
        { karte: 'rt_kachel_bewertung' },
      ] },
      { teile: [
        { karte: 'rt_treiber', breite: 14 },
        { karte: 'rt_intensitaet', breite: 10 },
      ] },
      { teile: [{ text: '## Die Betriebe\n\nSortiert nach Handlungsdruck: rot vor orange vor grün, innerhalb dessen nach Dringlichkeit.' }] },
      { teile: [{ karte: 'rt_tabelle', hoehe: 14,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Marken\n\nDie erste Frage vor jeder Maßnahme: schwächelt dieser eine Betrieb oder seine ganze Marke? Die Prozentwerte zeigen jeweils den mittleren Betrieb der Marke.' }] },
      { teile: [{ karte: 'rt_marke',
        klick: [{ ziel: 'dd_filialen', spalte: 'Marke', uebergabe: { marke: 'Marke' } }] }] },
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
        { karte: 'rt_historie' },
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
      { teile: [
        { karte: 'rt_massnahmen_status', breite: 8 },
        { karte: 'rt_massnahmen_offen', breite: 16, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
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
      { teile: [{ text: '# Welche Schwellen gelten?\n\nDer Round Table misst alle Betriebe an denselben Grenzen: **28 % grün, 32 % orange**. LINA führt je Betrieb eigene Grenzen (29/35, 30/34 …), die Standortgröße und Konzept berücksichtigen — dafür aber die Vergleichbarkeit untereinander kosten.\n\nDie Tabelle zeigt **nur die Betriebe, bei denen die Wahl tatsächlich zu einem anderen Urteil führt.** Bei allen übrigen erübrigt sich die Diskussion.' }] },
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
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# Struktur des Umsatzes\n\n> Bisher werden nur die Sparten **Speisen** und **Getränke** geliefert. Ihre Summe ist deshalb kleiner als der Gesamtumsatz — es fehlt nichts in der Rechnung, sondern in den gelieferten Daten.' }] },
      { teile: [
        { karte: 'st_sparte', breite: 14 },
        { karte: 'st_verkaufsstelle', breite: 10 },
      ] },
      { teile: [{ karte: 'st_sparte_anteil', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Tageszeit\n\nDer Geschäftstag läuft von 08:00 bis 07:59 des Folgetags. Die Nachtstunden gehören deshalb ans **Ende** des Tages, nicht an den Anfang.' }] },
      { teile: [
        { karte: 'st_stunde', breite: 14 },
        { karte: 'st_zeitzone', breite: 10 },
      ] },
      { teile: [{ karte: 'st_zeitzone_betrieb', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },

  {
    schluessel: 'db_personal',
    name: 'Personal — Kosten und Effektivität',
    beschreibung:
      'Personalkostenquoten und Umsatz je Personalstunde, gesamt und getrennt nach Service, Bar und Küche.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# Personal\n\nZwei verschiedene Kennzahlen, die im LINA-Bericht beide „Effektivität" heißen und deshalb hier getrennt stehen:\n\n- **Quote** — Personalkosten in Prozent vom Umsatz. Sagt, was das Personal kostet.\n- **Umsatz je Personalstunde** — in Euro. Sagt, was eine Arbeitsstunde einbringt.\n\nDie Ampel im Round Table beruht auf den **Personalkosten ohne Geschäftsführung** aus den Zahlen des Steuerberaters.' }] },
      { teile: [{ karte: 'pe_quote_betrieb', hoehe: 11, klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pe_quote_tabelle', hoehe: 11, klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ karte: 'pe_verlauf' }] },
      { teile: [{ karte: 'pe_bereich', hoehe: 11 }] },
      { teile: [{ karte: 'pe_effektivitaet', hoehe: 11 }] },
    ],
  },

  {
    schluessel: 'db_ware',
    name: 'Warenwirtschaft — Artikel, Deckungsbeitrag, Preise',
    beschreibung:
      'Was gut und was kaum läuft, Deckungsbeitrag je Warengruppe, rechnerischer gegen tatsächlichen Wareneinsatz und die Entwicklung der Einkaufspreise.',
    sammlung: 'Betrieb',
    filter: [F_BETRIEB, F_ZEITRAUM],
    reihen: [
      { teile: [{ text: '# Warenwirtschaft\n\n> **Bitte zuerst einen Zeitraum wählen.** Ohne Eingrenzung wertet die Seite die gesamte Historie aus und braucht entsprechend lange.\n\n> **Die Spalte „Abdeckung" zuerst lesen.** Sie sagt, für welchen Anteil des Umsatzes überhaupt Rezepturen hinterlegt sind. Steht dort 60 %, fällt der ausgewiesene Deckungsbeitrag zu günstig aus — man sieht es der Zahl selbst nicht an.\n\nDer Deckungsbeitrag liegt nur monatsweise vor: ein Zeitraum, der mitten im Monat beginnt, zählt den ganzen Monat mit.' }] },
      { teile: [
        { karte: 'wa_renner', hoehe: 12 },
        { karte: 'wa_penner', hoehe: 12 },
      ] },
      { teile: [{ karte: 'wa_db_warengruppe', hoehe: 11 }] },
      { teile: [{ text: '## Rechnerischer Wareneinsatz gegen tatsächlichen\n\nEine Lücke ist hier der **Normalfall** und genau die interessante Zahl: in ihr stecken Schwund, Bruch, Portionsgrößen, Personalverzehr und Lagerbewegung. Ein positiver Wert heißt, es wurde mehr eingekauft, als nach Rezeptur verbraucht wurde.' }] },
      { teile: [{ karte: 'wa_we_pruefung', hoehe: 11 }] },
      { teile: [{ text: '## Einkaufspreise\n\nDie Reihe beginnt mit der ersten Erfassung. Für die Zeit davor gibt es keine Preise, weil sie nirgends gespeichert wurden.' }] },
      { teile: [{ karte: 'wa_preise', hoehe: 11 }] },
    ],
  },

  {
    schluessel: 'db_bwa',
    name: 'BWA — Kennzahlen und Buchungsstand',
    beschreibung:
      'Umsatz, Wareneinsatz, Personalkosten und Ergebnis aus den Zahlen des Steuerberaters — und bis wann diese Zahlen überhaupt vorliegen.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# Betriebswirtschaftliche Auswertung (BWA)\n\n> **Diese Zahlen hinken hinterher.** Sie kommen vom Steuerberater und liegen üblicherweise ein bis zwei Monate zurück. Ein Monat, in dem alle Werte auf null stehen, ist **noch nicht gebucht** — er bedeutet nicht „kein Umsatz". Deshalb werden hier nur gebuchte Monate gezeigt.' }] },
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
      { teile: [{ text: '# Datenqualität\n\nDie Seite ist in der Reihenfolge aufgebaut, in der man nachfragt: **kommen die Daten an** → **stimmen die Zahlen** → **wem fehlt was**.\n\nEin Betrieb, dessen Daten fehlen, sieht auf jeder anderen Seite genauso aus wie einer, bei dem alles in Ordnung ist. Genau davor schützt diese Seite.' }] },
      { teile: [
        { karte: 'dq_befund', breite: 10 },
        { karte: 'dq_backfill_balken', breite: 14 },
      ] },
      { teile: [{ text: '## Kommen die Daten an?' }] },
      { teile: [{ karte: 'dq_backfill', hoehe: 11 }] },
      { teile: [{ karte: 'dq_sync' }] },
      { teile: [{ text: '## Stimmen die Zahlen?\n\n„Auffällig" ist eine **Arbeitsliste, kein Alarm**. Beim Wareneinsatz zählt die Spalte die Fälle, in denen zu wenige Rezepturen hinterlegt sind — nicht die inhaltlichen Abweichungen.' }] },
      { teile: [
        { karte: 'dq_pruefung', breite: 10 },
        { karte: 'dq_umsatz_abweichung', breite: 14 },
      ] },
      { teile: [{ text: '## Wem fehlt was?\n\nDie folgenden Tabellen sind Arbeitslisten. **Die Liste der Betriebe ohne Zuordnung zum Steuerberater sollte leer sein.**' }] },
      { teile: [{ karte: 'dq_datenstand', hoehe: 12 }] },
      { teile: [
        { karte: 'dq_ohne_bruecke' },
        { karte: 'dq_konzept' },
      ] },
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
      { teile: [{ text: '# Import — Überwachung\n\nOben der Zustand in vier Zahlen, darunter die Ursachen, dann was gerade läuft, unten die Vollständigkeit.\n\n> **„keine Daten" ist kein Fehler.** LINA antwortet mit HTTP 500 und leerem Body, wenn ein Betrieb für einen Bericht nichts hat — ein geschlossenes Haus oder ein Bericht, den dieser Betrieb nicht führt. Nur was unter „Fehler" steht, ist einer.' }] },
      { teile: [
        { karte: 'im_ampel' },
        { karte: 'im_prozent' },
        { karte: 'im_tempo' },
        { karte: 'im_restzeit' },
      ] },
      { teile: [{ karte: 'im_kopf' }] },

      { teile: [{ text: '## Woran hängt es?\n\n**Zuerst hierher sehen, wenn Zahlen fehlen.** Ruht der Zugang, steht alles andere still — dann ist keine weitere Suche nötig.\n\nSperren laufen von selbst ab; der Importer kommt ohne Zutun zurück. Ein Anmeldefehler ist die Ausnahme: den muss jemand ansehen, weil es nur diesen einen Zugang gibt.' }] },
      { teile: [{ karte: 'im_sperre' }] },
      { teile: [{ karte: 'im_fehler', hoehe: 9 }] },
      { teile: [{ karte: 'im_schema' }] },
      { teile: [{ karte: 'im_laeufe', hoehe: 11 }] },

      { teile: [{ text: '## Was läuft gerade?\n\nDer Puls zeigt, ob überhaupt etwas passiert. Eine Lücke ist eine Pause — Sperre, Tagesbudget oder kein laufender Prozess.' }] },
      { teile: [
        { karte: 'im_puls', breite: 14 },
        { karte: 'im_wartezeit', breite: 10 },
      ] },
      { teile: [{ karte: 'im_naechste', hoehe: 12 }] },

      { teile: [{ text: '## Wie vollständig ist es?\n\n**„Tage alt"** ist die Spalte, an der ein hängender Bericht auffällt: bei täglichen Berichten sind ein bis zwei Tage normal.\n\n**„wartet"** heißt nicht kaputt. Der laufende Betrieb hat Vorrang vor der Historie, deshalb können Historienposten länger unberührt bleiben.' }] },
      { teile: [{ karte: 'im_bericht', hoehe: 11 }] },
      { teile: [
        { karte: 'im_bericht_balken', breite: 12 },
        { karte: 'im_reichweite', breite: 12 },
      ] },
      { teile: [{ karte: 'im_betrieb', hoehe: 12 }] },
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
      { teile: [{ text: '# ⑧ Standortkarte\n\nEin Punkt je Standort, gefärbt nach der Gesamtampel des gewählten Monats. Ein Klick führt auf die Detailseite des Betriebs.\n\n> **Die Karte zeigt einen Ausschnitt, nicht das Ganze.** Nur für einen Teil der Betriebe sind Adressen hinterlegt — wer fehlt, steht ganz unten. Ein leerer Fleck auf der Karte heißt also nicht, dass dort kein Betrieb ist.\n\n**Die Ampel steht im Namen jedes Punkts** (🔴 🟠 🟢 ⚪), nicht in seiner Farbe: Metabase färbt Kartenpunkte nur nach Zahlen, nicht nach Kategorien. Antippen zeigt Bewertung, Umsatz und Handlungsbedarf — die Tabelle weiter unten listet dieselben Standorte nach Handlungsdruck sortiert.\n\n⚪ sind Betriebe ohne Bewertung, meist weil die Zahlen vom Steuerberater fehlen. Sie stehen bewusst mit auf der Karte: eine fehlende Bewertung ist eine Aussage, kein Grund zum Ausblenden.' }] },
      { teile: [{ karte: 'so_karte', hoehe: 16,
        klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Wie sich die Standorte verteilen' }] },
      { teile: [{ karte: 'so_verteilung', hoehe: 9 }] },
      { teile: [{ text: '## Dieselben Standorte als Liste\n\nSortiert nach Handlungsdruck. Die Spalte „Genauigkeit" sagt, wie genau der Punkt sitzt — „adresse" ist hausgenau, „ort" nur stadtgenau.' }] },
      { teile: [{ karte: 'so_tabelle', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
      { teile: [{ text: '## Wer fehlt auf der Karte\n\nFür diese Betriebe ist keine Adresse hinterlegt. **Die mit Umsatz stehen oben** — bei denen lohnt das Nachtragen zuerst.' }] },
      { teile: [{ karte: 'so_fehlend', hoehe: 12,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] }] },
    ],
  },
]
