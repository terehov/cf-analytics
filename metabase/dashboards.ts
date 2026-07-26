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
const F_MARKE: Parameter = {
  id: 'd-marke', name: 'marke', 'display-name': 'Marke', type: 'string/=',
}
const F_KONZEPT: Parameter = {
  id: 'd-konzept', name: 'konzept', 'display-name': 'Marke', type: 'string/=',
}
const F_BETRIEB: Parameter = {
  id: 'd-betrieb', name: 'betrieb', 'display-name': 'Betrieb', type: 'string/=',
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
      'Der Einstieg. Eine Zeile je Marke mit allen Metriken und der Ampelverteilung. Ein Klick auf den Markennamen öffnet die Filialen dieser Marke.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT],
    reihen: [
      { teile: [{ text: '# ① Marken\n\nDer Einstieg in die Kette **Marke → Filiale → Betrieb**. Ein Klick auf einen Markennamen führt eine Ebene tiefer.\n\nDie Prozentwerte sind **Mediane**, nicht Mittelwerte: bei 141 Betrieben reicht ein einzelner Ausreißer, um einen Mittelwert zu verziehen — am 26.07.2026 stand ein geschlossener Betrieb mit 1109 % Personalquote in den Daten. Die Ampeln werden **gezählt**, nicht gemittelt; der Mittelwert zweier Ampeln ist keine Ampel.' }] },
      { teile: [{ karte: 'dd_marken_tabelle', klick: [{ ziel: 'dd_filialen', spalte: 'Marke', uebergabe: { marke: 'Marke' } }] }] },
      { teile: [
        { karte: 'dd_marken_ampeln', klick: [{ ziel: 'dd_filialen', uebergabe: { marke: 'Marke' } }] },
        { karte: 'dd_marken_verlauf' },
      ] },
      { teile: [{ text: '## Marken nebeneinander\n\nJede Marke in jeder Metrik, mit dem Abstand zum Gesamtmedian. So ist unterscheidbar, ob eine Marke durchgehend schwächer ist oder nur in einer Disziplin.' }] },
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
      'Alle Betriebe — oder die einer Marke, wenn man von Ebene ① kommt — über sämtliche Metriken mit Ampeln. Ein Klick auf den Betriebsnamen öffnet das Betriebsblatt.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_MARKE],
    reihen: [
      { teile: [{ text: '# ② Filialen\n\nAlle Betriebe über sämtliche Metriken. Kommt man von ① Marken, ist der Marken-Filter oben bereits gesetzt — **löschen zeigt wieder alle Betriebe**.\n\nEin Klick auf einen Betriebsnamen öffnet ③ Betrieb. `⚪` heißt *keine Daten*, nicht *in Ordnung*.' }] },
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
      'Das Betriebsblatt. Alle Kennzahlen eines Betriebs an einer Stelle, jede Kachel führt in das passende Fach-Dashboard weiter. Oben den Betrieb wählen oder von Ebene ② herkommen.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# ③ Betrieb\n\nAlles zu einem Betrieb. **Zuerst auf „Datenstand" ganz unten sehen** — ohne zu wissen, wie alt die Zahlen sind, ist jede Schlussfolgerung von hier oben eine Vermutung.\n\nDie Diagramme führen per Klick in das jeweilige Fach-Dashboard, mit vorgesetztem Betrieb.' }] },
      { teile: [
        { karte: 'dd_betrieb_umsatz_kachel' },
        { karte: 'dd_betrieb_ytd_kachel' },
        { karte: 'dd_betrieb_gaeste_kachel' },
        { karte: 'dd_betrieb_bon_kachel' },
      ] },
      { teile: [{ text: '## Die sechs Round-Table-Metriken\n\nMit Vormonat, Veränderung und Ampelwechsel. Das ist die Zeile dieses Betriebs aus dem Excel-Blatt „Eingabe", aufgeklappt.' }] },
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
      'Zwei frei wählbare Zeiträume nebeneinander, je Betrieb und in Summe. Vorbelegt ist der laufende Monat bis heute gegen denselben Ausschnitt des Vormonats.',
    sammlung: 'Drill-Down',
    filter: [F_VON_A, F_BIS_A, F_VON_B, F_BIS_B, F_MARKE],
    reihen: [
      { teile: [{ text: '# ④ Zeiträume vergleichen\n\nOben vier Datumsfelder: **Zeitraum A** gegen **Zeitraum B**. Ohne Eingabe steht der laufende Monat bis heute gegen denselben Ausschnitt des Vormonats — ein Vergleich ganzer Monate wäre schief, solange der laufende noch läuft.\n\n> **Auf die Tage-Spalten sehen.** Zwei Zeiträume unterschiedlicher Länge zu vergleichen ist erlaubt, aber die Differenz heißt dann etwas anderes.' }] },
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
      'Mehrere Betriebe nebeneinander über alle Metriken, im Umsatzverlauf, im Tagesprofil und im Spartenmix. Oben die Betriebe wählen.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_BETRIEB, F_MARKE],
    reihen: [
      { teile: [{ text: '# ⑤ Standorte vergleichen\n\nOben Betrieb oder Marke einschränken. Ohne Auswahl stehen hier alle — für einen echten Vergleich zwei bis vier Betriebe wählen.\n\nDas Tagesprofil ist bewusst **in Prozent des eigenen Tagesumsatzes**: sonst vergleicht man Größe statt Muster.' }] },
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
      'Wo steckt der Umsatz, wie abhängig ist die Gruppe von wenigen Häusern, wie weit streuen vergleichbare Betriebe — und was wäre rechnerisch zu holen. Diese Fragen stellt das Excel-Ampelsystem nicht; bei 22 Betrieben beantwortet man sie im Kopf, bei 141 nicht mehr.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_MARKE],
    reihen: [
      { teile: [{ text: '# ⑥ Portfolio und Potenzial\n\nDas Excel-Ampelsystem war für **22 Betriebe einer Marke** gebaut und fragt deshalb nur „wer ist rot". Bei **141 Betrieben und mehreren Marken** sind das hier die Fragen davor: wo steckt der Umsatz, wovon hängen wir ab, wie groß ist die Streuung — und was kostet uns der Abstand.' }] },

      { teile: [{ text: '## Wo steckt der Umsatz\n\nAm 26.07.2026 kamen **70 % des Umsatzes aus dem stärksten Fünftel** der Betriebe. Das entscheidet, wie viel ein Prozentpunkt Verbesserung bei einem kleinen Haus wert ist — und wie weh eine Störung oben tut.\n\n> Achtung bei allen Anteilen auf dieser Seite: nur **62 der 141 geführten Betriebe machen überhaupt Umsatz**. Die übrigen liefern täglich Berichte über 0 €.' }] },
      { teile: [{ karte: 'pf_kachel_aktiv' }] },
      { teile: [
        { karte: 'pf_konzentration_kurve', breite: 10 },
        { karte: 'pf_konzentration', breite: 14, hoehe: 11 },
      ] },

      { teile: [{ text: '## Was wäre zu holen\n\n„€ bis Median" ist **kein Ziel und keine Prognose**, sondern eine Größenordnung: was der Abstand zum Mittelfeld in Euro bedeutet. Sortiert nach eben diesem Betrag — oben stehen die Betriebe, bei denen Arbeit am meisten bewegt.' }] },
      { teile: [{ karte: 'pf_potenzial', hoehe: 11 }] },
      { teile: [{ karte: 'pf_streuung' }] },

      { teile: [{ text: '## Karteileichen\n\n> Betriebe ohne Umsatz verzerren **jeden** Mittelwert und erzeugen absurde Quoten. Am 26.07.2026 stand „Enchilada Bremen" mit 1109 % Personalkosten bei 0 € Umsatz in der Ampel — eine gemeldete Katastrophe, wo gar kein Betrieb läuft. Diese Liste ist die Arbeitsvorlage, um sie auf inaktiv zu setzen.' }] },
      { teile: [{ karte: 'pf_karteileichen' }] },
    ],
  },

  {
    schluessel: 'pf_muster',
    name: '⑦ Muster im Geschäft',
    beschreibung:
      'Wochenrhythmus, Stabilität und die Frage, ob Umsatzveränderung von Gästen oder vom Bon kommt. Die Unterscheidung entscheidet über die Maßnahme.',
    sammlung: 'Drill-Down',
    filter: [F_BETRIEB, F_MARKE],
    reihen: [
      { teile: [{ text: '# ⑦ Muster im Geschäft\n\nDrei Fragen, die im Excel gar nicht vorkamen und über die Art der Maßnahme entscheiden.' }] },

      { teile: [{ text: '## Der Wochenrhythmus\n\nAm 26.07.2026 trug **Samstag rund das Zweieinhalbfache des Montags**. Jede Diskussion über Öffnungszeiten, Dienstpläne und Ruhetage fängt bei diesem Verhältnis an.' }] },
      { teile: [
        { karte: 'pf_wochentag' },
        { karte: 'pf_wochentag_marke' },
      ] },

      { teile: [{ text: '## Gäste oder Bon?\n\nEine Umsatzveränderung hat zwei mögliche Ursachen, und sie führen zu **verschiedenen Maßnahmen**: Frequenz ist ein Marketing- und Standortthema, der Bon ein Karten-, Preis- und Verkaufsthema. Im Excel war beides in einer Zahl vermischt.' }] },
      { teile: [{ karte: 'pf_gaeste_bon', hoehe: 12 }] },

      { teile: [{ text: '## Wie planbar läuft ein Betrieb\n\nSchwankung als Variationskoeffizient — relativ, damit große und kleine Häuser vergleichbar bleiben. Ein hoher Wert heißt Abhängigkeit von Wochenenden, Events oder Wetter und macht Personalplanung teuer.' }] },
      { teile: [{ karte: 'pf_stabilitaet', hoehe: 11 }] },
    ],
  },

  // ===================================================================
  // ROUND TABLE — die Excel-Abloesung
  // ===================================================================
  {
    schluessel: 'db_round_table',
    name: 'Round Table — Übersicht',
    beschreibung:
      'Ersetzt die Blätter 00_Dashboard und Eingabe aus JULI_Round_Table_Ampelsystem.xlsx. Oben die Zähler, darunter woran es liegt, unten die vollständige Betriebstabelle.',
    sammlung: 'Round Table',
    filter: [F_MONAT, F_KONZEPT],
    reihen: [
      { teile: [{ text: '# Round Table\n\nAmpellogik: 🟢 passt · 🟠 im Auge behalten · 🔴 sofort handeln.\n\n**„Ohne Urteil"** sind Betriebe, für die keine Ampel berechenbar war — meist fehlt die BWA. Im Excel fielen die unsichtbar unter den Tisch und sahen aus wie Betriebe ohne Befund.' }] },
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
      { teile: [{ text: '## Die Betriebe\n\nSortiert nach Handlungsdruck: rot vor orange vor grün, darin nach Eskalationsstufe. Das ist das Blatt „Eingabe".' }] },
      { teile: [{ karte: 'rt_tabelle', hoehe: 14 }] },
      { teile: [{ text: '## Marken\n\nBei 141 Betrieben ist die erste Frage vor jeder Maßnahme, ob der Betrieb schwächelt oder seine ganze Marke. Die Prozentwerte sind Mediane.' }] },
      { teile: [{ karte: 'rt_marke' }] },
      { teile: [{ karte: 'rt_marke_abweichung', hoehe: 11 }] },
    ],
  },

  {
    schluessel: 'db_rt_trend',
    name: 'Round Table — Trend und Ampelhistorie',
    beschreibung:
      'Ersetzt die Blätter Trend_2Monate und Ampelhistorie. Im Excel mussten die Vormonate von Hand eingetragen und die Historie durch Kopieren gepflegt werden — beides entfällt hier.',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    reihen: [
      { teile: [{ text: '# Trend und Historie\n\nDie Historie ist im Postgres automatisch da — das Blatt „Ampelhistorie" mit seinem „Werte kopieren und als Werte einfügen" entfällt ersatzlos.' }] },
      { teile: [
        { karte: 'rt_historie' },
        { karte: 'rt_historie_bereich' },
      ] },
      { teile: [{ text: '## Wer hat die Farbe gewechselt\n\nDie Liste, mit der ein Round Table anfangen sollte. Verschlechterungen zuerst.' }] },
      { teile: [{ karte: 'rt_ampelwechsel', hoehe: 11 }] },
      { teile: [{ text: '## Drei-Monats-Blick je Betrieb und Bereich\n\n↗ besser/gleich bzw. ↘ schlechter, mit der Richtung des jeweiligen Bereichs: bei Personal- und Wareneinsatzquoten ist ein kleinerer Wert besser.' }] },
      { teile: [{ karte: 'rt_trend_tabelle', hoehe: 12 }] },
    ],
  },

  {
    schluessel: 'db_rt_ursachen',
    name: 'Round Table — Ursachen und Maßnahmen',
    beschreibung:
      'Ersetzt die Blätter Ursachenanalyse und Massnahmen. Beide Quellen werden von Hand gepflegt — solange dort nichts steht, sind die Karten leer. Das heißt „nicht erfasst", nicht „keine Probleme".',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    reihen: [
      { teile: [{ text: '# Ursachen und Maßnahmen\n\n> **Diese Seite ist so gut wie ihre Pflege.** LINA kennt keine Ursachen und keine Maßnahmen; beides steht in `manual.ursache` und `manual.massnahme` und muss eingetragen werden. Eine leere Tabelle heißt hier „nicht erfasst", nicht „keine Probleme".' }] },
      { teile: [{ karte: 'rt_ursachen', hoehe: 11 }] },
      { teile: [{ karte: 'rt_ursachen_verlauf' }] },
      { teile: [{ text: '## Maßnahmen' }] },
      { teile: [
        { karte: 'rt_massnahmen_status', breite: 8 },
        { karte: 'rt_massnahmen_offen', breite: 16 },
      ] },
    ],
  },

  {
    schluessel: 'db_rt_regelwerk',
    name: 'Round Table — Regelwerk-Vergleich',
    beschreibung:
      'Die offene Entscheidung aus docs/kennzahlen-mapping.md: das Excel misst alle Betriebe an 28/32 %, LINA pflegt betriebsindividuelle Schwellen. Hier stehen beide Urteile nebeneinander — aber nur für die Betriebe, bei denen sie sich unterscheiden.',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    reihen: [
      { teile: [{ text: '# Welche Schwellen gelten?\n\nDas Excel-Blatt „Regeln" gibt **28 % grün / 32 % orange** für alle vor. LINA liefert je Betrieb eigene Schwellen (29/35, 30/34, …), die Standortgröße und Konzept berücksichtigen — dafür aber die Vergleichbarkeit im Round Table kosten.\n\nDie Tabelle zeigt **nur die Betriebe, bei denen die Wahl tatsächlich ein anderes Urteil ergibt.** Bei allen übrigen erübrigt sich die Diskussion.' }] },
      { teile: [{ karte: 'rt_regelwerk_vergleich', hoehe: 13 }] },
    ],
  },

  // ===================================================================
  // BETRIEB — die Fachberichte
  // ===================================================================
  {
    schluessel: 'db_umsatz',
    name: 'Umsatz — Entwicklung',
    beschreibung:
      'Umsatzentwicklung, Durchschnittsbon und Umsatz pro Kopf — die Prio-1-Berichte der Ebene „Laden" aus Umsetzung Berichte.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB, F_ZEITRAUM],
    reihen: [
      { teile: [{ text: '# Umsatz\n\nAlle Werte netto. `durchschnittsbon` und `umsatz_pro_gast` kommen fertig von LINA und werden nicht selbst nachgerechnet.' }] },
      { teile: [
        { karte: 'um_kachel_monat' },
        { karte: 'um_kachel_gaeste' },
        { karte: 'um_kachel_bon' },
      ] },
      { teile: [{ karte: 'um_verlauf_tag', hoehe: 9 }] },
      { teile: [{ text: '## Gegen Vorjahr\n\nEuro und Prozent stehen bewusst in **zwei** Diagrammen. Zwei Y-Achsen in einem Bild lassen sich beliebig gegeneinander verschieben und erfinden damit eine Beziehung, die in den Daten nicht steht.' }] },
      { teile: [
        { karte: 'um_verlauf_monat' },
        { karte: 'um_verlauf_delta' },
      ] },
      { teile: [
        { karte: 'um_bon_gast', breite: 14 },
        { karte: 'um_wochentag', breite: 10 },
      ] },
      { teile: [{ text: '## Rangliste\n\nDie letzten Zeilen sind die interessanten.' }] },
      { teile: [{ karte: 'um_rangliste', hoehe: 12 }] },
    ],
  },

  {
    schluessel: 'db_struktur',
    name: 'Umsatz — Struktur',
    beschreibung:
      'Wovon der Umsatz kommt: Sparte, Verkaufsstelle, Tageszeit, Zeitzone. Deckt „Umsatzentwicklung nach Sparte/Artikel/Tageszeit" und „Umsatz pro Verkaufsstelle" ab.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# Struktur des Umsatzes\n\n> Geholt werden bisher nur die Hauptsparten **Speisen** und **Getränke**. Ihre Summe ist deshalb kleiner als der Gesamtumsatz — das ist keine Lücke in der Rechnung, sondern im Import.' }] },
      { teile: [
        { karte: 'st_sparte', breite: 14 },
        { karte: 'st_verkaufsstelle', breite: 10 },
      ] },
      { teile: [{ karte: 'st_sparte_anteil', hoehe: 11 }] },
      { teile: [{ text: '## Tageszeit\n\nDer Geschäftstag läuft von 08:00 bis 07:59 des Folgetags. Die Stunden 0–7 gehören deshalb ans **Ende** des Tages, nicht an den Anfang.' }] },
      { teile: [
        { karte: 'st_stunde', breite: 14 },
        { karte: 'st_zeitzone', breite: 10 },
      ] },
      { teile: [{ karte: 'st_zeitzone_betrieb', hoehe: 11 }] },
    ],
  },

  {
    schluessel: 'db_personal',
    name: 'Personal — Kosten und Effektivität',
    beschreibung:
      'Personalkostenquoten und Effektivitäten, gesamt und je Bereich (Service, Bar, Küche). Prio 1 in Umsetzung Berichte.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# Personal\n\n`pek_*` sind **Quoten in Prozent**, `eff_*` ist **Umsatz je Personalstunde in Euro**. Im LINA-Bericht heißen beide „Effektivität"; deshalb stehen sie hier in getrennten Tabellen und nicht in einem Diagramm.\n\nDie Round-Table-Ampel beruht auf `persoog_bwa` — Personalkosten ohne Geschäftsführung aus der BWA, nicht auf `pek_gesamt`.' }] },
      { teile: [{ karte: 'pe_quote_betrieb', hoehe: 11 }] },
      { teile: [{ karte: 'pe_quote_tabelle', hoehe: 11 }] },
      { teile: [{ karte: 'pe_verlauf' }] },
      { teile: [{ karte: 'pe_bereich', hoehe: 11 }] },
      { teile: [{ karte: 'pe_effektivitaet', hoehe: 11 }] },
    ],
  },

  {
    schluessel: 'db_ware',
    name: 'Warenwirtschaft — Artikel, Deckungsbeitrag, Preise',
    beschreibung:
      'Renner und Penner, Deckungsbeitrag je Warengruppe, theoretischer gegen tatsächlichen Wareneinsatz, Einkaufspreise.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB, F_ZEITRAUM],
    reihen: [
      { teile: [{ text: '# Warenwirtschaft\n\n> **Zeitraum zuerst setzen.** `mart.artikelverkauf` liegt bei rund 20 Millionen Zeilen im Jahr und ist monatlich partitioniert — ein Filter auf den Geschäftstag liest nur die betroffenen Monate, ohne ihn die ganze Historie.\n\n> **Zuerst auf die Abdeckung sehen.** Sie sagt, welcher Anteil des Umsatzes überhaupt einen hinterlegten Wareneinsatzansatz hat. Bei 60 % Abdeckung ist jeder Deckungsbeitrag strukturell zu hoch, ohne dass man es der Zahl ansieht.' }] },
      { teile: [
        { karte: 'wa_renner', hoehe: 12 },
        { karte: 'wa_penner', hoehe: 12 },
      ] },
      { teile: [{ karte: 'wa_db_warengruppe', hoehe: 11 }] },
      { teile: [{ text: '## Theoretischer Wareneinsatz gegen BWA\n\nEine Lücke ist hier der **Normalfall** und die eigentliche Kennzahl: sie enthält Schwund, Bruch, Portionierung, Personalverzehr und Lagerbewegung. Ein positiver Wert heißt, es wurde mehr eingekauft als laut Rezeptur verbraucht.' }] },
      { teile: [{ karte: 'wa_we_pruefung', hoehe: 11 }] },
      { teile: [{ text: '## Einkaufspreise\n\nDie Reihe beginnt mit der ersten Momentaufnahme — rückwirkend gibt es nichts, weil LINA keine Preishistorie führt.' }] },
      { teile: [{ karte: 'wa_preise', hoehe: 11 }] },
    ],
  },

  {
    schluessel: 'db_bwa',
    name: 'BWA — Kennzahlen und Buchungsstand',
    beschreibung:
      'Umsatz, Wareneinsatz, Personalkosten und EBIT aus der Buchhaltung, plus die Frage, bis wann überhaupt gebucht ist.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB],
    reihen: [
      { teile: [{ text: '# BWA\n\n> **Die BWA hinkt nach.** Sie wird vom Steuerberater importiert und liegt üblicherweise ein bis zwei Monate zurück. Ein Monat, in dem alle Werte null sind, ist **nicht gebucht**, nicht „null Umsatz" — deshalb zeigen diese Karten nur gebuchte Monate.\n\nIm Excel wurde derselbe Versatz stillschweigend gepflegt: der Juli-Report trug Mai-Werte, erkennbar nur an einer Kopfzeile.' }] },
      { teile: [{ karte: 'bwa_kennzahlen', hoehe: 9 }] },
      { teile: [{ karte: 'bwa_ebit', hoehe: 11 }] },
      { teile: [{ text: '## Buchungsstand\n\nZwei Monate Verzug sind normal, vier sind eine Nachfrage beim Steuerberater wert.' }] },
      { teile: [{ karte: 'bwa_buchungsstand', hoehe: 12 }] },
    ],
  },

  {
    schluessel: 'db_datenqualitaet',
    name: 'Datenqualität und Import',
    beschreibung:
      'Läuft der Import, stimmen die Zahlen, welche Betriebe sind überhaupt beurteilbar. Die Seite, die man aufmacht, bevor man einer anderen glaubt.',
    sammlung: 'Betrieb',
    reihen: [
      { teile: [{ text: '# Datenqualität und Import\n\nDie Reihenfolge dieser Seite ist die Reihenfolge des Misstrauens: **läuft der Import** → **stimmen die Zahlen** → **wem fehlt was**.\n\nEin Betrieb, dessen Daten fehlen, sieht in jedem anderen Dashboard genauso aus wie einer, bei dem alles in Ordnung ist. Das ist der teuerste Irrtum, den dieses System anbieten kann — deshalb diese Seite.' }] },
      { teile: [
        { karte: 'dq_befund', breite: 10 },
        { karte: 'dq_backfill_balken', breite: 14 },
      ] },
      { teile: [{ text: '## Läuft der Import?' }] },
      { teile: [{ karte: 'dq_backfill', hoehe: 11 }] },
      { teile: [{ karte: 'dq_sync' }] },
      { teile: [{ text: '## Stimmen die Zahlen?\n\n„Auffällig" ist eine **Arbeitsliste, kein Alarm** — beim Wareneinsatz zählt die Spalte die Fälle mit zu dünner Artikelabdeckung, nicht die inhaltlichen Abweichungen.' }] },
      { teile: [
        { karte: 'dq_pruefung', breite: 10 },
        { karte: 'dq_umsatz_abweichung', breite: 14 },
      ] },
      { teile: [{ text: '## Wem fehlt was?\n\nDie folgenden Karten sind Arbeitslisten. **Erwartung für „Betriebe ohne BWA-Brücke": leer.**' }] },
      { teile: [{ karte: 'dq_datenstand', hoehe: 12 }] },
      { teile: [
        { karte: 'dq_ohne_bruecke' },
        { karte: 'dq_konzept' },
      ] },
    ],
  },
]
