// =====================================================================
// Die Dashboards und ihre Anordnung.
//
// Metabase rechnet in einem 24-Spalten-Raster. Eine Zeile ist rund 40
// Pixel hoch. Die Zahlen unten sind entsprechend: breite 24 ist volle
// Breite, breite 4 ist ein Sechstel.
//
// Grundsatz der Anordnung: oben steht, was man in drei Sekunden sehen
// will, darunter das, was man aufklappt, wenn oben etwas auffaellt.
// =====================================================================

import type { Dashboard, Parameter } from './typen'

const F_MONAT: Parameter = {
  id: 'd-monat',
  name: 'monat',
  'display-name': 'Monat',
  type: 'date/month-year',
  default: null,
}

const F_KONZEPT: Parameter = {
  id: 'd-konzept',
  name: 'konzept',
  'display-name': 'Marke',
  type: 'string/=',
}

const F_BETRIEB: Parameter = {
  id: 'd-betrieb',
  name: 'betrieb',
  'display-name': 'Betrieb',
  type: 'string/=',
}

const F_MARKE: Parameter = {
  id: 'd-marke',
  name: 'marke',
  'display-name': 'Marke',
  type: 'string/=',
}

// Vier Datumsfelder fuer den Zeitraumvergleich. Bewusst einzeln und nicht
// als zwei Bereichsfilter: Metabase kann einen Bereichsfilter nur EINEM
// Zeitraum zuordnen, hier brauchen beide Seiten ihren eigenen.
const F_VON_A: Parameter = { id: 'd-von-a', name: 'von_a', 'display-name': 'A von', type: 'date/single' }
const F_BIS_A: Parameter = { id: 'd-bis-a', name: 'bis_a', 'display-name': 'A bis', type: 'date/single' }
const F_VON_B: Parameter = { id: 'd-von-b', name: 'von_b', 'display-name': 'B von', type: 'date/single' }
const F_BIS_B: Parameter = { id: 'd-bis-b', name: 'bis_b', 'display-name': 'B bis', type: 'date/single' }

const F_ZEITRAUM: Parameter = {
  id: 'd-zeitraum',
  name: 'zeitraum',
  'display-name': 'Zeitraum',
  type: 'date/all-options',
}

export const dashboards: Dashboard[] = [
  // ===================================================================
  // DIE DRILL-DOWN-KETTE
  //
  // Marke → Filiale → Betrieb, und quer dazu zwei Vergleiche. Der Einstieg
  // ist "Marken"; von dort fuehrt jeder Klick eine Ebene tiefer, ohne dass
  // man den Filter von Hand nachziehen muesste.
  //
  // Die Uebergabe geht ueber die Dashboard-Filter: ein Klick auf die Marke
  // setzt den Marken-Filter des Zieldashboards. Damit bleibt der Weg
  // zurueck offen — man loescht den Filter und sieht wieder alles.
  // ===================================================================
  {
    schluessel: 'dd_marken',
    name: '① Marken',
    beschreibung:
      'Der Einstieg. Eine Zeile je Marke mit allen Metriken und der Ampelverteilung. Ein Klick auf den Markennamen öffnet die Filialen dieser Marke.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT],
    kacheln: [
      { karte: '', text: '# ① Marken\nDer Einstieg in die Kette **Marke → Filiale → Betrieb**. Ein Klick auf einen Markennamen führt eine Ebene tiefer.\n\nDie Prozentwerte sind **Mediane**, nicht Mittelwerte: bei 141 Betrieben reicht ein einzelner Ausreißer — ein Neubau im Anlaufjahr, ein Betrieb im Umbau —, um einen Mittelwert so zu verziehen, dass die halbe Marke unterdurchschnittlich aussieht. Die Ampeln werden **gezählt**, nicht gemittelt; der Mittelwert zweier Ampeln ist keine Ampel.', x: 0, y: 0, breite: 24, hoehe: 4 },

      { karte: 'dd_marken_tabelle', x: 0, y: 4, breite: 24, hoehe: 8,
        klick: [{ ziel: 'dd_filialen', spalte: 'Marke', uebergabe: { marke: 'Marke' } }] },

      { karte: 'dd_marken_ampeln',  x: 0,  y: 12, breite: 12, hoehe: 7,
        klick: [{ ziel: 'dd_filialen', uebergabe: { marke: 'Marke' } }] },
      { karte: 'dd_marken_verlauf', x: 12, y: 12, breite: 12, hoehe: 7 },
    ],
  },

  {
    schluessel: 'dd_filialen',
    name: '② Filialen',
    beschreibung:
      'Alle Betriebe — oder die einer Marke, wenn man von Ebene ① kommt — über sämtliche Metriken mit Ampeln. Ein Klick auf den Betriebsnamen öffnet das Betriebsblatt.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_MARKE],
    kacheln: [
      { karte: '', text: '# ② Filialen\nAlle Betriebe über sämtliche Metriken. Kommt man von ① Marken, ist der Marken-Filter oben bereits gesetzt — **löschen zeigt wieder alle Betriebe.**\n\nEin Klick auf einen Betriebsnamen öffnet ③ Betrieb. `⚪` heißt *keine Daten*, nicht *in Ordnung*.', x: 0, y: 0, breite: 24, hoehe: 3 },

      { karte: 'dd_filialen_tabelle', x: 0, y: 3, breite: 24, hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },

      { karte: 'dd_filialen_metrikvergleich', x: 0,  y: 14, breite: 10, hoehe: 7 },
      { karte: 'dd_filialen_rangliste',       x: 10, y: 14, breite: 14, hoehe: 7,
        klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] },

      { karte: '', text: '## Umsatz gegen Personalkosten\nRechts unten steht, was man sich wünscht: viel Umsatz bei niedriger Quote. Links oben die Betriebe, bei denen beides nicht stimmt.', x: 0, y: 21, breite: 24, hoehe: 2 },
      { karte: 'dd_filialen_streuung', x: 0, y: 23, breite: 24, hoehe: 8,
        klick: [{ ziel: 'dd_betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
    ],
  },

  {
    schluessel: 'dd_betrieb',
    name: '③ Betrieb',
    beschreibung:
      'Das Betriebsblatt. Alle Kennzahlen eines Betriebs an einer Stelle, jede Kachel führt in das passende Fach-Dashboard weiter. Oben den Betrieb wählen oder von Ebene ② herkommen.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_BETRIEB],
    kacheln: [
      { karte: '', text: '# ③ Betrieb\nAlles zu einem Betrieb. **Zuerst auf „Datenstand" ganz unten sehen** — ohne zu wissen, wie alt die Zahlen sind, ist jede Schlussfolgerung von hier oben eine Vermutung.\n\nDie Diagramme führen per Klick in das jeweilige Fach-Dashboard, mit vorgesetztem Betrieb.', x: 0, y: 0, breite: 24, hoehe: 3 },

      { karte: 'dd_betrieb_umsatz_kachel', x: 0,  y: 3, breite: 6, hoehe: 3 },
      { karte: 'dd_betrieb_ytd_kachel',    x: 6,  y: 3, breite: 6, hoehe: 3 },
      { karte: 'dd_betrieb_gaeste_kachel', x: 12, y: 3, breite: 6, hoehe: 3 },
      { karte: 'dd_betrieb_bon_kachel',    x: 18, y: 3, breite: 6, hoehe: 3 },

      { karte: '', text: '## Die sechs Round-Table-Metriken\nMit Vormonat, Veränderung und Ampelwechsel. Das ist die Zeile dieses Betriebs aus dem Blatt „Eingabe", aufgeklappt.', x: 0, y: 6, breite: 24, hoehe: 2 },
      { karte: 'dd_betrieb_kopf', x: 0, y: 8, breite: 24, hoehe: 7 },

      { karte: 'dd_betrieb_verlauf',      x: 0,  y: 15, breite: 14, hoehe: 7,
        klick: [{ ziel: 'db_umsatz', uebergabe: { betrieb: 'Betrieb' } }] },
      { karte: 'dd_betrieb_ampelverlauf', x: 14, y: 15, breite: 10, hoehe: 7 },

      { karte: '', text: '## Struktur', x: 0, y: 22, breite: 24, hoehe: 1 },
      { karte: 'dd_betrieb_sparte',   x: 0,  y: 23, breite: 8, hoehe: 6,
        klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },
      { karte: 'dd_betrieb_zeitzone', x: 8,  y: 23, breite: 8, hoehe: 6,
        klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },
      { karte: 'dd_betrieb_stunde',   x: 16, y: 23, breite: 8, hoehe: 6,
        klick: [{ ziel: 'db_struktur', uebergabe: { betrieb: 'Betrieb' } }] },

      { karte: '', text: '## Personal, Ware, BWA', x: 0, y: 29, breite: 24, hoehe: 1 },
      { karte: 'dd_betrieb_personal', x: 0,  y: 30, breite: 24, hoehe: 6,
        klick: [{ ziel: 'db_personal', uebergabe: { betrieb: 'Betrieb' } }] },
      { karte: 'dd_betrieb_artikel',  x: 0,  y: 36, breite: 12, hoehe: 8,
        klick: [{ ziel: 'db_ware', uebergabe: { betrieb: 'Betrieb' } }] },
      { karte: 'dd_betrieb_bwa',      x: 12, y: 36, breite: 12, hoehe: 8,
        klick: [{ ziel: 'db_bwa', uebergabe: { betrieb: 'Betrieb' } }] },

      { karte: '', text: '## Maßnahmen und Datenstand', x: 0, y: 44, breite: 24, hoehe: 1 },
      { karte: 'dd_betrieb_massnahmen', x: 0, y: 45, breite: 24, hoehe: 6 },
      { karte: 'dd_betrieb_datenstand', x: 0, y: 51, breite: 24, hoehe: 4 },
    ],
  },

  {
    schluessel: 'vg_zeit',
    name: '④ Zeiträume vergleichen',
    beschreibung:
      'Zwei frei wählbare Zeiträume nebeneinander, je Betrieb und in Summe. Vorbelegt ist der laufende Monat bis heute gegen denselben Ausschnitt des Vormonats.',
    sammlung: 'Drill-Down',
    filter: [F_VON_A, F_BIS_A, F_VON_B, F_BIS_B, F_MARKE],
    kacheln: [
      { karte: '', text: '# ④ Zeiträume vergleichen\nOben vier Datumsfelder: **Zeitraum A** gegen **Zeitraum B**. Ohne Eingabe steht der laufende Monat bis heute gegen denselben Ausschnitt des Vormonats — ein Vergleich ganzer Monate wäre schief, solange der laufende noch läuft.\n\n> **Auf die Tage-Spalten sehen.** Zwei Zeiträume unterschiedlicher Länge zu vergleichen ist erlaubt, aber die Differenz heißt dann etwas anderes.', x: 0, y: 0, breite: 24, hoehe: 4 },

      { karte: 'vg_zeit_summe',   x: 0, y: 4,  breite: 24, hoehe: 5 },
      { karte: 'vg_zeit_verlauf', x: 0, y: 9,  breite: 24, hoehe: 7 },

      { karte: '', text: '## Je Betrieb\nEin Klick auf den Betriebsnamen öffnet das Betriebsblatt.', x: 0, y: 16, breite: 24, hoehe: 1 },
      { karte: 'vg_zeit_betrieb', x: 0, y: 17, breite: 24, hoehe: 11,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },
    ],
  },

  {
    schluessel: 'vg_ort',
    name: '⑤ Standorte vergleichen',
    beschreibung:
      'Mehrere Betriebe nebeneinander über alle Metriken, im Umsatzverlauf, im Tagesprofil und im Spartenmix. Oben die Betriebe wählen.',
    sammlung: 'Drill-Down',
    filter: [F_MONAT, F_BETRIEB, F_MARKE],
    kacheln: [
      { karte: '', text: '# ⑤ Standorte vergleichen\nOben Betrieb oder Marke einschränken. Ohne Auswahl stehen hier alle — für einen echten Vergleich zwei bis vier Betriebe wählen.\n\nDas Tagesprofil ist bewusst **in Prozent des eigenen Tagesumsatzes**: sonst vergleicht man Größe statt Muster.', x: 0, y: 0, breite: 24, hoehe: 3 },

      { karte: 'vg_ort_metriken', x: 0, y: 3, breite: 24, hoehe: 10,
        klick: [{ ziel: 'dd_betrieb', spalte: 'Betrieb', uebergabe: { betrieb: 'Betrieb' } }] },

      { karte: 'vg_ort_umsatz',  x: 0,  y: 13, breite: 12, hoehe: 7 },
      { karte: 'vg_ort_profil',  x: 12, y: 13, breite: 12, hoehe: 7 },
      { karte: 'vg_ort_sparte',  x: 0,  y: 20, breite: 24, hoehe: 7 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_round_table',
    name: 'Round Table — Übersicht',
    beschreibung:
      'Ersetzt das Blatt 00_Dashboard und Eingabe aus JULI_Round_Table_Ampelsystem.xlsx. Oben die Zähler, darunter woran es liegt, unten die vollständige Betriebstabelle. Monat oben rechts umstellen.',
    sammlung: 'Round Table',
    filter: [F_MONAT, F_KONZEPT],
    kacheln: [
      { karte: '', text: '# Round Table\nAmpellogik: 🟢 passt · 🟠 im Auge behalten · 🔴 sofort handeln. **„Ohne Urteil"** sind Betriebe, für die keine Ampel berechenbar war — meist fehlt die BWA. Im Excel fielen die unsichtbar unter den Tisch.', x: 0, y: 0, breite: 24, hoehe: 2 },

      { karte: 'rt_kachel_rot',        x: 0,  y: 2, breite: 4, hoehe: 3 },
      { karte: 'rt_kachel_orange',     x: 4,  y: 2, breite: 4, hoehe: 3 },
      { karte: 'rt_kachel_gruen',      x: 8,  y: 2, breite: 4, hoehe: 3 },
      { karte: 'rt_kachel_ohne_urteil',x: 12, y: 2, breite: 4, hoehe: 3 },
      { karte: 'rt_kachel_massnahmen', x: 16, y: 2, breite: 4, hoehe: 3 },
      { karte: 'rt_kachel_bewertung',  x: 20, y: 2, breite: 4, hoehe: 3 },

      { karte: 'rt_treiber',     x: 0,  y: 5, breite: 14, hoehe: 6 },
      { karte: 'rt_intensitaet', x: 14, y: 5, breite: 10, hoehe: 6 },

      { karte: '', text: '## Die Betriebe\nSortiert nach Handlungsdruck: rot vor orange vor grün, darin nach Eskalationsstufe. Das ist das Blatt „Eingabe".', x: 0, y: 11, breite: 24, hoehe: 1 },
      { karte: 'rt_tabelle', x: 0, y: 12, breite: 24, hoehe: 12 },

      { karte: '', text: '## Marken\nBei 141 Betrieben ist die erste Frage vor jeder Maßnahme, ob der Betrieb schwächelt oder seine ganze Marke. Die Prozentwerte sind Mediane.', x: 0, y: 24, breite: 24, hoehe: 1 },
      { karte: 'rt_marke',            x: 0,  y: 25, breite: 24, hoehe: 6 },
      { karte: 'rt_marke_abweichung', x: 0,  y: 31, breite: 24, hoehe: 8 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_rt_trend',
    name: 'Round Table — Trend und Ampelhistorie',
    beschreibung:
      'Ersetzt die Blätter Trend_2Monate und Ampelhistorie. Im Excel mussten die Vormonate von Hand eingetragen und die Historie durch Kopieren gepflegt werden — beides entfällt hier.',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    kacheln: [
      { karte: '', text: '# Trend und Historie\nDie Historie ist im Postgres automatisch da — das Blatt „Ampelhistorie" mit seinem „Werte kopieren und als Werte einfügen" entfällt ersatzlos.', x: 0, y: 0, breite: 24, hoehe: 2 },

      { karte: 'rt_historie',         x: 0,  y: 2, breite: 12, hoehe: 6 },
      { karte: 'rt_historie_bereich', x: 12, y: 2, breite: 12, hoehe: 6 },

      { karte: '', text: '## Wer hat die Farbe gewechselt\nDie Liste, mit der ein Round Table anfangen sollte. Verschlechterungen zuerst.', x: 0, y: 8, breite: 24, hoehe: 1 },
      { karte: 'rt_ampelwechsel', x: 0, y: 9, breite: 24, hoehe: 8 },

      { karte: '', text: '## Drei-Monats-Blick je Betrieb und Bereich\n↗ besser/gleich bzw. ↘ schlechter, mit der Richtung des jeweiligen Bereichs: bei Personal- und Wareneinsatzquoten ist ein kleinerer Wert besser.', x: 0, y: 17, breite: 24, hoehe: 1 },
      { karte: 'rt_trend_tabelle', x: 0, y: 18, breite: 24, hoehe: 10 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_rt_ursachen',
    name: 'Round Table — Ursachen und Maßnahmen',
    beschreibung:
      'Ersetzt die Blätter Ursachenanalyse und Massnahmen. Beide Quellen werden von Hand gepflegt (manual.ursache, manual.massnahme) — solange dort nichts steht, sind die Karten leer. Das heißt „nicht erfasst", nicht „keine Probleme".',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    kacheln: [
      { karte: '', text: '# Ursachen und Maßnahmen\n> **Diese Seite ist so gut wie ihre Pflege.** LINA kennt keine Ursachen und keine Maßnahmen; beides steht in `manual.ursache` und `manual.massnahme` und muss eingetragen werden. Eine leere Tabelle heißt hier „nicht erfasst".', x: 0, y: 0, breite: 24, hoehe: 2 },

      { karte: 'rt_ursachen', x: 0, y: 2, breite: 24, hoehe: 8 },
      { karte: 'rt_ursachen_verlauf', x: 0, y: 10, breite: 24, hoehe: 6 },

      { karte: '', text: '## Maßnahmen', x: 0, y: 16, breite: 24, hoehe: 1 },
      { karte: 'rt_massnahmen_status', x: 0,  y: 17, breite: 8,  hoehe: 6 },
      { karte: 'rt_massnahmen_offen',  x: 8,  y: 17, breite: 16, hoehe: 6 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_rt_regelwerk',
    name: 'Round Table — Regelwerk-Vergleich',
    beschreibung:
      'Die offene Entscheidung aus docs/kennzahlen-mapping.md Zeile K: das Excel misst alle Betriebe an 28/32 %, LINA pflegt betriebsindividuelle Schwellen. Hier stehen beide Urteile nebeneinander — aber nur für die Betriebe, bei denen sie sich unterscheiden.',
    sammlung: 'Round Table',
    filter: [F_MONAT],
    kacheln: [
      { karte: '', text: '# Welche Schwellen gelten?\nDas Excel-Blatt „Regeln" gibt 28 % grün / 32 % orange für alle vor. LINA liefert je Betrieb eigene Schwellen (29/35, 30/34, …), die Standortgröße und Konzept berücksichtigen — dafür aber die Vergleichbarkeit im Round Table kosten.\n\nDie Tabelle zeigt **nur die Betriebe, bei denen die Wahl tatsächlich ein anderes Urteil ergibt.** Bei allen übrigen erübrigt sich die Diskussion.', x: 0, y: 0, breite: 24, hoehe: 3 },
      { karte: 'rt_regelwerk_vergleich', x: 0, y: 3, breite: 24, hoehe: 10 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_umsatz',
    name: 'Umsatz — Entwicklung',
    beschreibung:
      'Umsatzentwicklung, Durchschnittsbon und Umsatz pro Kopf — die Prio-1-Berichte der Ebene „Laden" aus Umsetzung Berichte.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB, F_ZEITRAUM],
    kacheln: [
      { karte: '', text: '# Umsatz\nAlle Werte netto. `durchschnittsbon` und `umsatz_pro_gast` kommen fertig von LINA und werden nicht selbst nachgerechnet.', x: 0, y: 0, breite: 24, hoehe: 2 },

      { karte: 'um_kachel_monat',  x: 0, y: 2, breite: 8, hoehe: 3 },
      { karte: 'um_kachel_gaeste', x: 8, y: 2, breite: 8, hoehe: 3 },
      { karte: 'um_kachel_bon',    x: 16, y: 2, breite: 8, hoehe: 3 },

      { karte: 'um_verlauf_tag',   x: 0, y: 5,  breite: 24, hoehe: 7 },
      { karte: 'um_verlauf_monat', x: 0, y: 12, breite: 14, hoehe: 7 },
      { karte: 'um_wochentag',     x: 14, y: 12, breite: 10, hoehe: 7 },
      { karte: 'um_bon_gast',      x: 0, y: 19, breite: 24, hoehe: 6 },

      { karte: '', text: '## Rangliste\nDie letzten Zeilen sind die interessanten.', x: 0, y: 25, breite: 24, hoehe: 1 },
      { karte: 'um_rangliste', x: 0, y: 26, breite: 24, hoehe: 10 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_struktur',
    name: 'Umsatz — Struktur',
    beschreibung:
      'Wovon der Umsatz kommt: Sparte, Verkaufsstelle, Tageszeit, Zeitzone. Deckt „Umsatzentwicklung nach Sparte/Artikel/Tageszeit" und „Umsatz pro Verkaufsstelle" ab.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB],
    kacheln: [
      { karte: '', text: '# Struktur des Umsatzes\n> Geholt werden bisher nur die Hauptsparten **Speisen** und **Getränke**. Ihre Summe ist deshalb kleiner als der Gesamtumsatz — das ist keine Lücke in der Rechnung, sondern im Import.', x: 0, y: 0, breite: 24, hoehe: 2 },

      { karte: 'st_sparte',          x: 0,  y: 2,  breite: 14, hoehe: 7 },
      { karte: 'st_verkaufsstelle',  x: 14, y: 2,  breite: 10, hoehe: 7 },
      { karte: 'st_sparte_anteil',   x: 0,  y: 9,  breite: 24, hoehe: 8 },

      { karte: '', text: '## Tageszeit\nDer Geschäftstag läuft von 08:00 bis 07:59 des Folgetags. Die Stunden 0–7 gehören deshalb ans **Ende** des Tages, nicht an den Anfang.', x: 0, y: 17, breite: 24, hoehe: 2 },
      { karte: 'st_stunde',          x: 0,  y: 19, breite: 14, hoehe: 7 },
      { karte: 'st_zeitzone',        x: 14, y: 19, breite: 10, hoehe: 7 },
      { karte: 'st_zeitzone_betrieb',x: 0,  y: 26, breite: 24, hoehe: 8 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_personal',
    name: 'Personal — Kosten und Effektivität',
    beschreibung:
      'Personalkostenquoten und Effektivitäten, gesamt und je Bereich (Service, Bar, Küche). Prio 1 in Umsetzung Berichte.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB],
    kacheln: [
      { karte: '', text: '# Personal\n`pek_*` sind **Quoten in Prozent**, `eff_*` ist **Umsatz je Personalstunde in Euro**. Im LINA-Bericht heißen beide „Effektivität"; wer sie in ein Diagramm legt, bekommt zwei Achsen.\n\nDie Round-Table-Ampel beruht auf `persoog_bwa` — Personalkosten ohne Geschäftsführung aus der BWA, nicht auf `pek_gesamt`.', x: 0, y: 0, breite: 24, hoehe: 3 },

      { karte: 'pe_quote_betrieb', x: 0, y: 3,  breite: 24, hoehe: 8 },
      { karte: 'pe_verlauf',       x: 0, y: 11, breite: 24, hoehe: 6 },
      { karte: 'pe_bereich',       x: 0, y: 17, breite: 24, hoehe: 8 },
      { karte: 'pe_effektivitaet', x: 0, y: 25, breite: 24, hoehe: 8 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_ware',
    name: 'Warenwirtschaft — Artikel, Deckungsbeitrag, Preise',
    beschreibung:
      'Renner und Penner, Deckungsbeitrag je Warengruppe, theoretischer gegen tatsächlichen Wareneinsatz, Einkaufspreise. Deckt „Abverkaufszahlen pro Artikel", „WE und DB pro Artikel" und „Theoretische WE vs. BWA" ab.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB, F_ZEITRAUM],
    kacheln: [
      { karte: '', text: '# Warenwirtschaft\n> **Zeitraum zuerst setzen.** `mart.artikelverkauf` liegt bei rund 20 Millionen Zeilen im Jahr und ist monatlich partitioniert — ein Filter auf den Geschäftstag liest nur die betroffenen Monate, ohne ihn die ganze Historie.\n\n> **Zuerst auf die Abdeckung sehen.** Sie sagt, welcher Anteil des Umsatzes überhaupt einen hinterlegten Wareneinsatzansatz hat. Bei 60 % Abdeckung ist jeder Deckungsbeitrag strukturell zu hoch, ohne dass man es der Zahl ansieht.', x: 0, y: 0, breite: 24, hoehe: 4 },

      { karte: 'wa_renner', x: 0,  y: 4,  breite: 12, hoehe: 10 },
      { karte: 'wa_penner', x: 12, y: 4,  breite: 12, hoehe: 10 },

      { karte: 'wa_db_warengruppe', x: 0, y: 14, breite: 24, hoehe: 8 },

      { karte: '', text: '## Theoretischer Wareneinsatz gegen BWA\nEine Lücke ist hier der **Normalfall** und die eigentliche Kennzahl: sie enthält Schwund, Bruch, Portionierung, Personalverzehr und Lagerbewegung. Ein positiver Wert heißt, es wurde mehr eingekauft als laut Rezeptur verbraucht.', x: 0, y: 22, breite: 24, hoehe: 2 },
      { karte: 'wa_we_pruefung', x: 0, y: 24, breite: 24, hoehe: 8 },

      { karte: '', text: '## Einkaufspreise\nDie Reihe beginnt mit der ersten Momentaufnahme — rückwirkend gibt es nichts, weil LINA keine Preishistorie führt.', x: 0, y: 32, breite: 24, hoehe: 2 },
      { karte: 'wa_preise', x: 0, y: 34, breite: 24, hoehe: 8 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_bwa',
    name: 'BWA — Kennzahlen und Buchungsstand',
    beschreibung:
      'Umsatz, Wareneinsatz, Personalkosten und EBIT aus der Buchhaltung, plus die Frage, bis wann überhaupt gebucht ist.',
    sammlung: 'Betrieb',
    filter: [F_MONAT, F_BETRIEB],
    kacheln: [
      { karte: '', text: '# BWA\n> **Die BWA hinkt nach.** Sie wird vom Steuerberater importiert und liegt üblicherweise ein bis zwei Monate zurück. Ein Monat, in dem alle Werte null sind, ist **nicht gebucht**, nicht „null Umsatz" — deshalb zeigen diese Karten nur gebuchte Monate.\n\nIm Excel wurde derselbe Versatz stillschweigend gepflegt: der Juli-Report trug Mai-Werte, erkennbar nur an einer Kopfzeile.', x: 0, y: 0, breite: 24, hoehe: 3 },

      { karte: 'bwa_kennzahlen', x: 0, y: 3,  breite: 24, hoehe: 7 },
      { karte: 'bwa_ebit',       x: 0, y: 10, breite: 24, hoehe: 8 },

      { karte: '', text: '## Buchungsstand\nZwei Monate Verzug sind normal, vier sind eine Nachfrage beim Steuerberater wert.', x: 0, y: 18, breite: 24, hoehe: 1 },
      { karte: 'bwa_buchungsstand', x: 0, y: 19, breite: 24, hoehe: 10 },
    ],
  },

  // ===================================================================
  {
    schluessel: 'db_datenqualitaet',
    name: 'Datenqualität und Import',
    beschreibung:
      'Läuft der Import, stimmen die Zahlen, welche Betriebe sind überhaupt beurteilbar. Die Seite, die man aufmacht, bevor man einer anderen glaubt.',
    sammlung: 'Betrieb',
    kacheln: [
      { karte: '', text: '# Datenqualität und Import\nDie Reihenfolge dieser Seite ist die Reihenfolge des Misstrauens: **läuft der Import** → **stimmen die Zahlen** → **wem fehlt was**.\n\nEin Betrieb, dessen Daten fehlen, sieht in jedem anderen Dashboard genauso aus wie ein Betrieb, bei dem alles in Ordnung ist. Das ist der teuerste Irrtum, den dieses System anbieten kann — deshalb diese Seite.', x: 0, y: 0, breite: 24, hoehe: 3 },

      { karte: 'dq_befund',         x: 0,  y: 3, breite: 10, hoehe: 6 },
      { karte: 'dq_backfill_balken',x: 10, y: 3, breite: 14, hoehe: 6 },

      { karte: '', text: '## Läuft der Import?', x: 0, y: 9, breite: 24, hoehe: 1 },
      { karte: 'dq_backfill', x: 0, y: 10, breite: 24, hoehe: 8 },
      { karte: 'dq_sync',     x: 0, y: 18, breite: 24, hoehe: 6 },

      { karte: '', text: '## Stimmen die Zahlen?\n„Auffällig" ist eine **Arbeitsliste, kein Alarm** — beim Wareneinsatz zählt die Spalte die Fälle mit zu dünner Artikelabdeckung, nicht die inhaltlichen Abweichungen.', x: 0, y: 24, breite: 24, hoehe: 2 },
      { karte: 'dq_pruefung',          x: 0, y: 26, breite: 10, hoehe: 5 },
      { karte: 'dq_umsatz_abweichung', x: 10, y: 26, breite: 14, hoehe: 5 },

      { karte: '', text: '## Wem fehlt was?\nDie beiden folgenden Karten sind Arbeitslisten. **Erwartung für „Betriebe ohne BWA-Brücke": leer.**', x: 0, y: 31, breite: 24, hoehe: 2 },
      { karte: 'dq_datenstand',  x: 0, y: 33, breite: 24, hoehe: 10 },
      { karte: 'dq_ohne_bruecke',x: 0, y: 43, breite: 12, hoehe: 6 },
      { karte: 'dq_konzept',     x: 12, y: 43, breite: 12, hoehe: 6 },
    ],
  },
]
